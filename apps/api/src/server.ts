import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { createPublicClient, createWalletClient, http, parseEther, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { campaignRegistryAbi, createOrderRequest, numaRouterAbi, relayRequest, whitechainSepolia } from "@numa/shared";
import { loadEnv, type Env } from "./config/env.js";
import { OrderSigner } from "@numa/sdk-server";
import { Relayer, RelayError } from "./services/relayer.js";
import { reconcileSent } from "./services/reconciler.js";
import { MemoryRelayStore } from "./services/store.js";
import pg from "pg";
import { migrate } from "./db/migrate.js";
import { PgCursorStore, PgRelayStore } from "./db/pgStore.js";
import { createArkivReader, createArkivWriter } from "@numa/arkiv";
import { arkivConversionSink } from "./integrations/arkivSink.js";
import { Indexer, MemoryCursor, noopSink } from "./services/indexer.js";
import { ReleaseKeeper } from "./services/keeper.js";
import { MemoryReleaseQueue } from "./services/releaseQueue.js";
import { registerCors } from "./routes/cors.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerClickRoutes, type ClickDeps } from "./routes/clicks.js";
import { MemoryClickStore } from "./services/clicks.js";
import { PgClickStore, PgReleaseQueue } from "./db/pgStore.js";
import { creatorReputation } from "./services/reputationService.js";
import { resolveLink } from "@numa/arkiv";

export function buildServer(env: Env) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization"] } });
  const chain = { ...whitechainSepolia, id: env.WHITECHAIN_CHAIN_ID };
  const transport = http(env.WHITECHAIN_RPC_URL);
  const pub = createPublicClient({ chain, transport });
  const relayerAccount = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`);
  const wallet = createWalletClient({ account: relayerAccount, chain, transport });
  const pool = env.DATABASE_URL ? new pg.Pool({ connectionString: env.DATABASE_URL }) : undefined;
  if (pool) {
    app.addHook("onReady", async () => { const done = await migrate(pool); if (done.length) app.log.info({ migrations: done }); });
    app.addHook("onClose", async () => { await pool.end(); });
  } else app.log.warn("DATABASE_URL not set: relayer limits and indexer cursor are in-memory");
  const relayStore = pool ? new PgRelayStore(pool) : new MemoryRelayStore();
  const relayer = new Relayer(
    {
      router: env.NUMA_ROUTER_ADDRESS, registry: env.CAMPAIGN_REGISTRY_ADDRESS, chainId: env.WHITECHAIN_CHAIN_ID,
      maxGasPriceWei: parseGwei(String(env.RELAYER_MAX_GAS_PRICE_GWEI)),
      dailyCapWei: parseEther(String(env.RELAYER_DAILY_CAP_WBT)),
      perAddressDailyLimit: env.RELAYER_PER_ADDRESS_DAILY_LIMIT,
    },
    pub, wallet, relayerAccount, relayStore,
  );
  const orders = env.MERCHANT_SIGNER_KEY
    ? new OrderSigner(privateKeyToAccount(env.MERCHANT_SIGNER_KEY as `0x${string}`), env.WHITECHAIN_CHAIN_ID, env.NUMA_ROUTER_ADDRESS, env.ORDER_TTL_SECONDS)
    : undefined;

  const corsOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (corsOrigins.length) registerCors(app, corsOrigins);
  app.register(rateLimit, { max: env.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });

  app.get("/health", async () => ({
    ok: true, chainId: env.WHITECHAIN_CHAIN_ID, relayer: relayerAccount.address,
    relayerBalanceWei: (await pub.getBalance({ address: relayerAccount.address }).catch(() => null))?.toString() ?? null,
  }));

  // Demo merchant order service. Real merchants sign orders in their own backend via @numa/sdk-server.
  // Requires CAMPAIGN_REGISTRY_ADDRESS: merchant and commissionBps come from the on-chain campaign,
  // never from the request body - a caller cannot assert its own split terms.
  app.post("/orders", async (req, reply) => {
    if (!orders) return reply.code(501).send({ error: "MERCHANT_SIGNER_KEY not configured" });
    if (!env.CAMPAIGN_REGISTRY_ADDRESS) return reply.code(501).send({ error: "CAMPAIGN_REGISTRY_ADDRESS not configured" });
    const p = createOrderRequest.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid request", issues: p.error.issues });
    const [campaign, feeBps] = await Promise.all([
      pub.readContract({ address: env.CAMPAIGN_REGISTRY_ADDRESS, abi: campaignRegistryAbi, functionName: "getCampaign", args: [p.data.campaignId] }),
      pub.readContract({ address: env.NUMA_ROUTER_ADDRESS, abi: numaRouterAbi, functionName: "feeBps" }),
    ]);
    if (!campaign.exists) return reply.code(404).send({ error: "unknown campaignId" });
    const o = await orders.createOrder({ ...p.data, merchant: campaign.merchant, commissionBps: campaign.commissionBps, feeBps });
    return {
      order: Object.fromEntries(Object.entries(o.order).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
      digest: o.digest, authNonce: o.authNonce, merchantSig: o.merchantSig, payoutSigner: o.payoutSigner,
    };
  });

  // Frontend polling: what happened to this order's relay?
  app.get("/relay/:orderId", async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) return reply.code(400).send({ error: "invalid orderId" });
    const c = await relayStore.getClaim(orderId as `0x${string}`);
    if (!c) return reply.code(404).send({ error: "unknown order" });
    return { orderId: c.orderId, status: c.status, txHash: c.txHash, explorer: c.txHash ? `${whitechainSepolia.blockExplorers.default.url}/tx/${c.txHash}` : null };
  });

  app.post("/relay", async (req, reply) => {
    const p = relayRequest.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid request", issues: p.error.issues });
    try {
      const r = await relayer.submit(p.data, (o) => req.log.info(o));
      return { status: "settled", txHash: r.txHash, blockNumber: r.blockNumber.toString() };
    } catch (e) {
      if (e instanceof RelayError) return reply.code(e.code === "DUPLICATE" ? 409 : 422).send({ error: e.code, message: e.message });
      req.log.error(e);
      return reply.code(500).send({ error: "INTERNAL" });
    }
  });

  // Resolve relays whose outcome was never recorded (timeouts, crashes) from chain receipts.
  {
    let rt: ReturnType<typeof setInterval> | undefined;
    app.addHook("onReady", async () => {
      let busy = false;
      rt = setInterval(async () => {
        if (busy) return; busy = true;
        try { await reconcileSent(relayStore, pub, {}, (o) => app.log.info(o)); } catch (e) { app.log.error(e, "reconcile failed"); } finally { busy = false; }
      }, 15_000);
    });
    app.addHook("onClose", async () => { if (rt) clearInterval(rt); });
  }

  let linkOwnedBy: ClickDeps["linkOwnedBy"];
  let settledFor: ClickDeps["settledFor"];

  // Chain indexer: always on. It queues releases for the keeper and, when an Arkiv writer wallet is
  // configured, also mirrors conversions to Arkiv (otherwise it mirrors nothing).
  const releaseQueue = pool ? new PgReleaseQueue(pool) : new MemoryReleaseQueue();
  const writerAccount = env.ARKIV_WRITER_PRIVATE_KEY ? privateKeyToAccount(env.ARKIV_WRITER_PRIVATE_KEY as `0x${string}`) : undefined;
  const reader = writerAccount ? createArkivReader(env.ARKIV_ACCESS_KEY) : undefined;
  const sink = writerAccount && reader
    ? arkivConversionSink(reader, createArkivWriter({ account: writerAccount, accessKey: env.ARKIV_ACCESS_KEY }), writerAccount.address)
    : noopSink;
  const indexer = new Indexer(
    pub, env.NUMA_ROUTER_ADDRESS, sink,
    pool ? new PgCursorStore(pool, "router", env.INDEXER_START_BLOCK - 1n) : new MemoryCursor(env.INDEXER_START_BLOCK - 1n),
    2_000n, 1n,
    { settled: (e) => releaseQueue.add(e.orderId, e.paidAt), released: (e) => releaseQueue.markDone(e.orderId) },
  );
  const keeper = new ReleaseKeeper(
    { router: env.NUMA_ROUTER_ADDRESS, maxGasPriceWei: parseGwei(String(env.RELAYER_MAX_GAS_PRICE_GWEI)), dailyCapWei: parseEther(String(env.RELAYER_DAILY_CAP_WBT)) },
    pub, wallet, relayerAccount, releaseQueue, relayStore,
  );
  {
    const timers: ReturnType<typeof setInterval>[] = [];
    const loop = (name: string, ms: number, fn: () => Promise<unknown>) => {
      let busy = false;
      timers.push(setInterval(async () => {
        if (busy) return; busy = true;
        try { await fn(); } catch (e) { app.log.error(e, `${name} tick failed`); } finally { busy = false; }
      }, ms));
    };
    app.addHook("onReady", async () => {
      loop("indexer", env.INDEXER_POLL_MS, () => indexer.tick((o) => app.log.info(o)));
      loop("keeper", env.KEEPER_POLL_MS, () => keeper.tick((o) => app.log.info(o)));
    });
    app.addHook("onClose", async () => { timers.forEach(clearInterval); });
  }

  // Arkiv-backed read features (reputation, discovery) need the Numa writer wallet's address.
  if (writerAccount && reader) {
    linkOwnedBy = async (p) => !!(await resolveLink(reader, { code: p.code, campaignId: p.campaignId, expectedCreator: p.creator }));
    const settleCache = new Map();
    settledFor = async ({ creator, campaignId }) => {
      const { verified } = await creatorReputation({ arkiv: reader, pub, router: env.NUMA_ROUTER_ADDRESS, writer: writerAccount.address, cache: settleCache }, creator);
      const live = verified.filter((v) => v.campaignId === campaignId && v.status !== "refunded");
      return { verifiedConversions: live.length, grossSettled: live.reduce((a, v) => a + v.gross, 0n), commissionEarned: live.reduce((a, v) => a + v.commission, 0n) };
    };
    registerDiscoveryRoutes(app, { arkiv: reader, pub, router: env.NUMA_ROUTER_ADDRESS, writer: writerAccount.address, ...(env.CAMPAIGN_REGISTRY_ADDRESS && { registry: env.CAMPAIGN_REGISTRY_ADDRESS }), cache: new Map(), timeoutMs: env.DISCOVERY_TIMEOUT_MS });
  }

  registerClickRoutes(app, {
    clicks: pool ? new PgClickStore(pool) : new MemoryClickStore(), checkoutBaseUrl: env.CHECKOUT_BASE_URL,
    clickRateLimitPerMinute: env.CLICK_RATE_LIMIT_PER_MINUTE, visitorSecret: env.CLICK_VISITOR_SECRET,
    ...(linkOwnedBy && { linkOwnedBy }), ...(settledFor && { settledFor }),
  });
  return app;
}

if (process.argv[1]?.endsWith("server.ts")) {
  const env = loadEnv();
  buildServer(env).listen({ port: env.PORT, host: "0.0.0.0" });
}
