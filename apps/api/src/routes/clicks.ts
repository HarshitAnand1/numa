import type { FastifyInstance } from "fastify";
import { isAddress, type Address } from "viem";
import { visitorHash, type ClickStore } from "../services/clicks.js";

export interface ClickDeps {
  clicks: ClickStore;
  /** Where buyers land, e.g. https://numa.example — the link code is appended as /checkout/<code>. */
  checkoutBaseUrl: string;
  /** Click endpoint limit per IP per minute. High on purpose: bot traffic must be counted, not blocked. */
  clickRateLimitPerMinute: number;
  /** Secret mixed into visitor hashes (any random string; rotates the daily salt). */
  visitorSecret: string;
  /** True if the Arkiv link `code` for `campaignId` is owned by `creator` (undefined when Arkiv is not configured). */
  linkOwnedBy?: (p: { code: string; campaignId: bigint; creator: Address }) => Promise<boolean>;
  /** Chain-verified settled sales for a creator in a campaign (undefined when Arkiv is not configured). */
  settledFor?: (p: { creator: Address; campaignId: bigint }) => Promise<{ verifiedConversions: number; grossSettled: bigint; commissionEarned: bigint }>;
  now?: () => Date;
}

const CODE = /^[A-Za-z0-9_-]{4,32}$/;

export function registerClickRoutes(app: FastifyInstance, d: ClickDeps) {
  const now = d.now ?? (() => new Date());

  // Counts every click (including bots) and redirects to checkout. Clicks never produce commission.
  app.get("/r/:code", { config: { rateLimit: { max: d.clickRateLimitPerMinute, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { code } = req.params as { code: string };
    if (!CODE.test(code)) return reply.code(400).send({ error: "invalid link code" });
    const day = now().toISOString().slice(0, 10);
    await d.clicks.record(code, visitorHash(req.ip, String(req.headers["user-agent"] ?? ""), day, d.visitorSecret));
    return reply.redirect(`${d.checkoutBaseUrl.replace(/\/$/, "")}/checkout/${encodeURIComponent(code)}`, 302);
  });

  /**
   * Clicks vs money for one link. Requires the claimed creator + campaign; when Arkiv is configured the link
   * entity must be owned by that creator, and sales are only counted if they verify against OrderSettled.
   */
  app.get("/links/:code/stats", async (req, reply) => {
    const { code } = req.params as { code: string };
    const q = req.query as { creator?: string; campaignId?: string };
    if (!CODE.test(code)) return reply.code(400).send({ error: "invalid link code" });
    const clicks = await d.clicks.stats(code);
    if (!q.creator && !q.campaignId) return { code, ...clicks, settled: null, note: "pass creator and campaignId to include verified sales" };
    if (!q.creator || !isAddress(q.creator) || !q.campaignId || !/^\d+$/.test(q.campaignId)) return reply.code(400).send({ error: "creator (address) and campaignId (integer) are both required" });
    if (!d.linkOwnedBy || !d.settledFor) return { code, ...clicks, settled: null, note: "Arkiv/chain verification not configured" };
    const campaignId = BigInt(q.campaignId);
    if (!(await d.linkOwnedBy({ code, campaignId, creator: q.creator }))) return reply.code(404).send({ error: "no link with this code owned by that creator for this campaign" });
    const s = await d.settledFor({ creator: q.creator, campaignId });
    return { code, ...clicks, settled: { verifiedConversions: s.verifiedConversions, grossSettled: s.grossSettled.toString(), commissionEarned: s.commissionEarned.toString() } };
  });
}
