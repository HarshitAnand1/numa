import type { FastifyInstance } from "fastify";
import { isAddress, type Address, type PublicClient } from "viem";
import { campaignRegistryAbi } from "@numa/shared";
import {
  findLinksByCode, getProfile, listCampaigns, listDecisions, listEndorsements, listInvitesFor, listLiveOffers, listOffers, listOffersByCreator, searchCreators, topConversions, type ArkivReader,
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

  /**
   * Offers on a campaign, for the merchant's review screen. Each offer carries the creator's profile summary, the merchant's
   * decision (trusted only if authored by the campaign's on-chain merchant) and whether the creator is approved on-chain
   * (the authority; null when no registry is configured). Paged with `limit` (max 50) and `offset`.
   */
  app.get("/campaigns/:id/offers", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    if (!/^\d+$/.test(id)) return reply.code(400).send({ error: "BAD_REQUEST", message: "campaign id must be a number" });
    const campaignId = BigInt(id);
    const limit = num(q.limit, 25, 50), offset = /^\d+$/.test(q.offset ?? "") ? Math.min(Number(q.offset), 10_000) : 0;
    const merchant = await merchantOf(campaignId);
    const [offers, decisions] = await Promise.all([
      listOffers(d.arkiv, campaignId, limit, offset),
      merchant ? listDecisions(d.arkiv, campaignId, merchant) : Promise.resolve([]),
    ]);
    const decisionFor = new Map(decisions.map((x) => [x.offerKey.toLowerCase(), x.result]));
    const creators = [...new Set(offers.map((o) => o.creator.toLowerCase()))];
    const profiles = new Map(await Promise.all(creators.map(async (c) => [c, await getProfile(d.arkiv, c as Address).catch(() => undefined)] as const)));
    const approved = async (creator: Address): Promise<boolean | null> => {
      if (!d.registry) return null;
      try { return await d.pub.readContract({ address: d.registry, abi: campaignRegistryAbi, functionName: "isCreatorApproved", args: [campaignId, creator] }); } catch { return null; }
    };
    return ser({
      campaignId, merchant, merchantVerified: merchant !== null, count: offers.length, offset,
      offers: await Promise.all(offers.map(async (o) => {
        const p = profiles.get(o.creator.toLowerCase());
        return {
          offerKey: o.entityKey, creator: o.creator, channel: o.channel, audience: o.audience, askBps: o.askBps, expectedReach: o.expectedReach,
          profile: p ? { displayName: p.displayName, niche: p.niche, channel: p.channel } : null,
          decision: decisionFor.get(String(o.entityKey).toLowerCase()) ?? null, approvedOnChain: await approved(o.creator),
        };
      })),
    });
  });

  const approvedOnChain = async (campaignId: bigint, creator: Address): Promise<boolean | null> => {
    if (!d.registry) return null;
    try { return await d.pub.readContract({ address: d.registry, abi: campaignRegistryAbi, functionName: "isCreatorApproved", args: [campaignId, creator] }); } catch { return null; }
  };

  /**
   * Resolve an attribution link code to its creator and campaign, so `/r/:code` -> `/checkout/:code` can work on its own.
   * Anyone can publish a link with any code, so a candidate counts only if its owner is APPROVED for that campaign on-chain
   * (the router would reject anyone else anyway). If several approved creators claimed the same code, the one that published
   * first wins (creation block) and `claims` tells the caller there was a conflict.
   */
  app.get("/links/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) return reply.code(400).send({ error: "BAD_REQUEST", message: "link code must be 4-32 chars [A-Za-z0-9_-]" });
    if (!d.registry) return reply.code(503).send({ error: "REGISTRY_NOT_CONFIGURED", message: "cannot verify creators without CAMPAIGN_REGISTRY_ADDRESS" });
    const candidates = await findLinksByCode(d.arkiv, code);
    if (candidates.length === 0) return reply.code(404).send({ error: "NOT_FOUND", message: "no live link with this code" });
    const verified: (typeof candidates[number] & { settleable: boolean | null })[] = [];
    for (const c of candidates) {
      if ((await approvedOnChain(c.campaignId, c.creator)) !== true) continue;
      let settleable: boolean | null = null;
      try { settleable = await d.pub.readContract({ address: d.registry, abi: campaignRegistryAbi, functionName: "isSettleable", args: [c.campaignId] }); } catch { /* unknown */ }
      verified.push({ ...c, settleable });
    }
    const win = verified[0];
    if (!win) return reply.code(404).send({ error: "NOT_APPROVED", message: "this link's creator is not approved for the campaign on-chain" });
    const merchant = await merchantOf(win.campaignId);
    return ser({ code, creator: win.creator, campaignId: win.campaignId, merchant, approved: true, settleable: win.settleable, claims: verified.length });
  });

  /**
   * A creator's own live offers with where each stands: the merchant's decision (trusted only if authored by the campaign's
   * on-chain merchant) and the on-chain approval (the authority). `status` is approved, rejected or pending.
   */
  app.get("/creators/:address/offers", async (req, reply) => {
    const address = (req.params as { address: string }).address;
    const q = req.query as { limit?: string; offset?: string };
    if (!isAddress(address)) return reply.code(400).send({ error: "invalid address" });
    const limit = num(q.limit, 25, 50), offset = /^\d+$/.test(q.offset ?? "") ? Math.min(Number(q.offset), 10_000) : 0;
    const [offers, campaigns] = await Promise.all([listOffersByCreator(d.arkiv, address, limit, offset), listCampaigns(d.arkiv, { limit: 100 }, now())]);
    const byId = new Map(campaigns.map((c) => [c.campaignId.toString(), c]));
    const decisionCache = new Map<string, Map<string, string>>();
    const decisionFor = async (campaignId: bigint, offerKey: string) => {
      const k = campaignId.toString();
      if (!decisionCache.has(k)) {
        const m = await merchantOf(campaignId);
        const ds = m ? await listDecisions(d.arkiv, campaignId, m).catch(() => []) : [];
        decisionCache.set(k, new Map(ds.map((x) => [String(x.offerKey).toLowerCase(), x.result])));
      }
      return decisionCache.get(k)!.get(offerKey.toLowerCase()) ?? null;
    };
    const out = await Promise.all(offers.map(async (o) => {
      const camp = byId.get(o.campaignId.toString());
      const [decision, approved] = await Promise.all([decisionFor(o.campaignId, o.entityKey), approvedOnChain(o.campaignId, address)]);
      return {
        offerKey: o.entityKey, campaignId: o.campaignId, campaignName: camp?.name ?? null, campaignCategory: camp?.category ?? null, campaignCommissionBps: camp ? Number(camp.commissionBps) : null,
        channel: o.channel, audience: o.audience, askBps: o.askBps, expectedReach: o.expectedReach, decision, approvedOnChain: approved,
        status: approved === true || decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "pending",
      };
    }));
    return ser({ creator: address, count: out.length, offset, offers: out });
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
