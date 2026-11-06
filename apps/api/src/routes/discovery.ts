import type { FastifyInstance } from "fastify";
import { isAddress, type Address, type PublicClient } from "viem";
import { campaignRegistryAbi } from "@numa/shared";
import {
  getProfile, listCampaigns, listEndorsements, listInvitesFor, listLiveOffers, searchCreators, topConversions, type ArkivReader,
} from "@numa/arkiv";
import { leaderboard, recommendCampaigns, trendingCampaigns } from "../services/discovery.js";
import { summarizeEndorsements, verifiedEndorsements } from "../services/endorsements.js";
import { creatorReputation, verifyClaims } from "../services/reputationService.js";
import type { SettledCache } from "../services/verify.js";

export interface DiscoveryDeps {
  arkiv: ArkivReader; pub: PublicClient; router: Address; writer: Address;
  /** CampaignRegistry address; when absent, Arkiv-claimed campaign ownership is reported as unverified (null). */
  registry?: Address;
  cache?: SettledCache;
  now?: () => number;
  /** Max ms per request before a 504; Arkiv queries can stall without an access key. Default 15000. */
  timeoutMs?: number;
}

const ser = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const num = (v: unknown, d: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : d; };

export function registerDiscoveryRoutes(app: FastifyInstance, d: DiscoveryDeps) {
  const now = d.now ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = d.timeoutMs ?? 15_000;
  // Bound every discovery request: race the handler against a timer and answer 504 instead of hanging.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/discovery") && !req.url.startsWith("/creators")) return;
    const timer = setTimeout(() => { if (!reply.sent) void reply.code(504).send({ error: "UPSTREAM_TIMEOUT", message: "Arkiv query timed out" }); }, timeoutMs);
    reply.raw.once("close", () => clearTimeout(timer));
  });
  const merchantCache = new Map<string, Address | null>();

  /** On-chain merchant of a campaign (the authority). null when no registry is configured or the read fails.
   * CampaignRegistry has no `merchantOf` function - the merchant is a field on the `Campaign`
   * tuple returned by `getCampaign`. See docs/PROJECT_STATUS.md -> "Interface reconciliation". */
  async function merchantOf(campaignId: bigint): Promise<Address | null> {
    if (!d.registry) return null;
    const k = campaignId.toString();
    if (merchantCache.has(k)) return merchantCache.get(k)!;
    try {
      const campaign = await d.pub.readContract({ address: d.registry, abi: campaignRegistryAbi, functionName: "getCampaign", args: [campaignId] });
      merchantCache.set(k, campaign.merchant);
      return campaign.merchant;
    } catch { return null; }
  }
  const owns = async (owner: string, campaignId: bigint) => {
    const m = await merchantOf(campaignId);
    return m === null ? null : m.toLowerCase() === owner.toLowerCase();
  };
  const campaignsWithTrust = async (q: Parameters<typeof listCampaigns>[1]) => {
    const rows = await listCampaigns(d.arkiv, q, now());
    return Promise.all(rows.map(async (c) => ({ ...c, merchantVerified: await owns(c.merchant, c.campaignId) })));
  };

  app.get("/discovery/campaigns", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const sort = q.sort === "commission" || q.sort === "endingSoon" ? q.sort : undefined;
    return ser(await campaignsWithTrust({
      ...(q.category && { category: q.category }), ...(q.region && { region: q.region }),
      ...(q.minCommissionBps && { minCommissionBps: Number(q.minCommissionBps) }), ...(sort && { sort }), limit: num(q.limit, 50, 100),
    }));
  });

  app.get("/discovery/trending", async (req) => {
    const campaigns = await campaignsWithTrust({ limit: 100 });
    const offers = await listLiveOffers(d.arkiv);
    return ser(trendingCampaigns(offers, campaigns, num((req.query as { limit?: string }).limit, 10, 50)));
  });

  app.get("/discovery/creators", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const profiles = await searchCreators(d.arkiv, {
      ...(q.niche && { niche: q.niche }), ...(q.channel && { channel: q.channel }),
      ...(q.maxAskBps && { maxAskBps: Number(q.maxAskBps) }), openOnly: q.openOnly !== "false", limit: num(q.limit, 25, 50),
    });
    return ser(await Promise.all(profiles.map(async (p) => {
      const { reputation } = await creatorReputation({ ...d }, p.creator as Address);
      return { ...p, reputation: { score: reputation.score, verifiedConversions: reputation.verifiedConversions, label: reputation.label } };
    })));
  });

  app.get("/discovery/leaderboard", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const sinceUnix = q.days ? now() - num(q.days, 30, 90) * 86400 : undefined;
    const claims = await topConversions(d.arkiv, {
      writer: d.writer, ...(q.campaignId && /^\d+$/.test(q.campaignId) && { campaignId: BigInt(q.campaignId) }), ...(sinceUnix !== undefined && { sinceUnix }), limit: 100,
    });
    const { verified } = await verifyClaims(d, claims);
    return ser(leaderboard(verified.map((v) => ({ creator: v.creator, buyer: v.buyer, gross: v.gross, commission: v.commission, refunded: v.status === "refunded" })), num(q.limit, 20, 50)));
  });

  const creatorParam = (req: { params: unknown }) => (req.params as { address: string }).address;

  /** The creator card: profile + verified sales + score + verified endorsements, one view. */
  app.get("/creators/:address", async (req, reply) => {
    const address = creatorParam(req);
    if (!isAddress(address)) return reply.code(400).send({ error: "invalid address" });
    const [profile, rep, endorsementClaims] = await Promise.all([
      getProfile(d.arkiv, address), creatorReputation({ ...d }, address), listEndorsements(d.arkiv, address),
    ]);
    const { accepted, rejected: rejectedEndorsements } = await verifiedEndorsements(d.pub, d.router, endorsementClaims.map((e) => ({ ...e, merchant: e.merchant })), d.cache);
    return ser({
      address, profile: profile ?? null,
      reputation: rep.reputation,
      endorsements: { ...summarizeEndorsements(accepted), items: accepted.map((e) => ({ merchant: e.merchant, rating: e.rating, note: e.note, campaignId: e.campaignId, txHash: e.txHash })) },
      recentSales: rep.verified.sort((a, b) => b.paidAt - a.paidAt).slice(0, 10).map((v) => ({ txHash: v.txHash, campaignId: v.campaignId, gross: v.gross, commission: v.commission, status: v.status, paidAt: v.paidAt })),
      rejected: { conversions: rep.rejected, endorsements: rejectedEndorsements },
    });
  });

  app.get("/creators/:address/reputation", async (req, reply) => {
    const address = creatorParam(req);
    if (!isAddress(address)) return reply.code(400).send({ error: "invalid address" });
    const { reputation, rejected } = await creatorReputation({ ...d }, address);
    return ser({ ...reputation, rejected });
  });

  app.get("/creators/:address/recommendations", async (req, reply) => {
    const address = creatorParam(req);
    if (!isAddress(address)) return reply.code(400).send({ error: "invalid address" });
    const profile = await getProfile(d.arkiv, address);
    if (!profile) return reply.code(404).send({ error: "no profile published for this creator" });
    const campaigns = await campaignsWithTrust({ limit: 100 });
    return ser(recommendCampaigns(profile, campaigns, now()));
  });

  /** Invites addressed to the creator. `verified` = the inviting wallet is the campaign's on-chain merchant (null = unknown, no registry). */
  app.get("/creators/:address/invites", async (req, reply) => {
    const address = creatorParam(req);
    if (!isAddress(address)) return reply.code(400).send({ error: "invalid address" });
    const invites = await listInvitesFor(d.arkiv, address);
    return ser(await Promise.all(invites.map(async (i) => ({ ...i, verified: await owns(i.merchant, i.campaignId) }))));
  });
}
