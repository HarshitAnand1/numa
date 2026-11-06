import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { createPublicClient, createWalletClient, http, parseEther, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { campaignRegistryAbi, createOrderRequest, numaRouterAbi, relayRequest, whitechainSepolia } from "@numa/shared";
import { loadEnv, type Env } from "./config/env.js";
import { OrderSigner } from "@numa/sdk-server";
import { Relayer, RelayError } from "./services/relayer.js";
import { MemoryRelayStore } from "./services/store.js";
import pg from "pg";
import { migrate } from "./db/migrate.js";
import { PgCursorStore, PgRelayStore } from "./db/pgStore.js";
import { createArkivReader, createArkivWriter } from "@numa/arkiv";
import { arkivConversionSink } from "./integrations/arkivSink.js";
import { Indexer, MemoryCursor } from "./services/indexer.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";

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
  const relayer = new Relayer(
    {
      router: env.NUMA_ROUTER_ADDRESS, registry: env.CAMPAIGN_REGISTRY_ADDRESS, chainId: env.WHITECHAIN_CHAIN_ID,
      maxGasPriceWei: parseGwei(String(env.RELAYER_MAX_GAS_PRICE_GWEI)),
      dailyCapWei: parseEther(String(env.RELAYER_DAILY_CAP_WBT)),
      perAddressDailyLimit: env.RELAYER_PER_ADDRESS_DAILY_LIMIT,
    },
    pub, wallet, relayerAccount, pool ? new PgRelayStore(pool) : new MemoryRelayStore(),
  );
  const orders = env.MERCHANT_SIGNER_KEY
    ? new OrderSigner(privateKeyToAccount(env.MERCHANT_SIGNER_KEY as `0x${string}`), env.WHITECHAIN_CHAIN_ID, env.NUMA_ROUTER_ADDRESS, env.ORDER_TTL_SECONDS)
    : undefined;

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

  // Arkiv-backed features (conversion indexer + reputation) need the Numa writer wallet.
  if (env.ARKIV_WRITER_PRIVATE_KEY) {
    const writerAccount = privateKeyToAccount(env.ARKIV_WRITER_PRIVATE_KEY as `0x${string}`);
    const reader = createArkivReader(env.ARKIV_ACCESS_KEY);
    const writer = createArkivWriter({ account: writerAccount, accessKey: env.ARKIV_ACCESS_KEY });
    const indexer = new Indexer(pub, env.NUMA_ROUTER_ADDRESS, arkivConversionSink(reader, writer, writerAccount.address), pool ? new PgCursorStore(pool, "router", env.INDEXER_START_BLOCK - 1n) : new MemoryCursor(env.INDEXER_START_BLOCK - 1n));
    let timer: ReturnType<typeof setInterval> | undefined;
    app.addHook("onReady", async () => {
      let busy = false;
      timer = setInterval(async () => {
        if (busy) return; busy = true;
        try { await indexer.tick((o) => app.log.info(o)); } catch (e) { app.log.error(e, "indexer tick failed"); } finally { busy = false; }
      }, env.INDEXER_POLL_MS);
    });
    app.addHook("onClose", async () => { if (timer) clearInterval(timer); });

    registerDiscoveryRoutes(app, { arkiv: reader, pub, router: env.NUMA_ROUTER_ADDRESS, writer: writerAccount.address, ...(env.CAMPAIGN_REGISTRY_ADDRESS && { registry: env.CAMPAIGN_REGISTRY_ADDRESS }), cache: new Map() });
  }
  return app;
}

if (process.argv[1]?.endsWith("server.ts")) {
  const env = loadEnv();
  buildServer(env).listen({ port: env.PORT, host: "0.0.0.0" });
}
