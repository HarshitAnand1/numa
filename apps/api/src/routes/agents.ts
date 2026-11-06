import type { FastifyInstance } from "fastify";
import { encodeFunctionData, isAddress, isHex, type Address, type Hex, type PublicClient } from "viem";
import { campaignRegistryAbi, CampaignRegistryAbi } from "@numa/shared";
import { listAgentBindings, listCampaigns, listLiveOffers, type ArkivReader } from "@numa/arkiv";
import { loadThread, type Thread } from "../agents/runner.js";
import { parsePolicy, verifyPolicyAuth, type Role } from "../agents/policy.js";
import type { PolicyStore } from "../agents/store.js";

export interface AgentRouteDeps {
  arkiv: ArkivReader; pub: PublicClient; registry: Address; store: PolicyStore;
  /** The agent wallet principals must bind with a numa.agent entity. Absent = agents disabled. */
  agentAddress?: Address;
  now?: () => number;
}

const ser = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const roleOf = (v: unknown): Role | null => (v === "creator" || v === "merchant" ? v : null);

export function registerAgentRoutes(app: FastifyInstance, d: AgentRouteDeps) {
  const now = d.now ?? (() => Math.floor(Date.now() / 1000));
  const merchantCache = new Map<string, Address | null>();
  const merchantOf = async (id: bigint): Promise<Address | null> => {
    const k = id.toString();
    if (merchantCache.has(k)) return merchantCache.get(k)!;
    try {
      const c = await d.pub.readContract({ address: d.registry, abi: campaignRegistryAbi, functionName: "getCampaign", args: [id] });
      if (!c.exists) return null;
      merchantCache.set(k, c.merchant);
      return c.merchant;
    } catch { return null; }
  };

  /** Where users bind the agent. Never exposes any policy. */
  app.get("/agents/status", async () => ({ enabled: !!d.agentAddress, agentAddress: d.agentAddress ?? null }));

  // Policy is private (the counterparty must not see a floor or ceiling): both writing and reading require an EIP-191 signature from the principal.
  app.post("/agents/policy", async (req, reply) => {
    const b = req.body as { policy?: unknown; issuedAt?: number; signature?: string } | null;
    let policy;
    try { policy = parsePolicy(b?.policy); } catch (e) { return reply.code(400).send({ error: "BAD_POLICY", message: e instanceof Error ? e.message : "invalid" }); }
    if (!isHex(b?.signature) || typeof b?.issuedAt !== "number") return reply.code(400).send({ error: "BAD_REQUEST", message: "signature and issuedAt required" });
    if (!(await verifyPolicyAuth({ action: "write", principal: policy.principal, role: policy.role, issuedAt: b.issuedAt, body: b.policy, signature: b.signature as Hex, now: now() }))) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "signature does not prove control of the principal (or is stale)" });
    }
    await d.store.upsert(policy);
    return { ok: true, enabled: policy.enabled };
  });

  app.post("/agents/policy/read", async (req, reply) => {
    const b = req.body as { principal?: string; role?: string; issuedAt?: number; signature?: string } | null;
    const role = roleOf(b?.role);
    if (!b?.principal || !isAddress(b.principal) || !role || !isHex(b.signature) || typeof b.issuedAt !== "number") return reply.code(400).send({ error: "BAD_REQUEST" });
    if (!(await verifyPolicyAuth({ action: "read", principal: b.principal, role, issuedAt: b.issuedAt, signature: b.signature as Hex, now: now() }))) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return (await d.store.get(b.principal, role)) ?? reply.code(404).send({ error: "NOT_FOUND" });
  });

  const summary = (t: Thread, campaignName: string | undefined) => {
    const last = t.verified.filter((m) => m.verifiedOwner).at(-1);
    return {
      offerKey: t.offerKey, campaignId: t.campaignId, ...(campaignName && { campaignName }), creator: t.creator, merchant: t.merchant,
      offerAskBps: t.offerAskBps, state: t.state.kind, ...(t.state.kind === "deal" && { agreedBps: t.state.bps }), round: t.state.seq,
      messageCount: t.messages.length, ignoredMessages: t.verified.length - t.messages.length,
      ...(last && { last: { from: last.from, action: last.action, bps: last.bps, note: last.note, seq: last.seq } }),
    };
  };

  /**
   * "My threads": every live offer the principal is a party to, with its verified negotiation state. Public data only (Arkiv is public),
   * so no signature is needed. Creator = offers they own; merchant = offers on campaigns whose on-chain merchant is the principal.
   */
  app.get("/agents/threads", async (req, reply) => {
    const q = req.query as { principal?: string; role?: string; limit?: string };
    const role = roleOf(q.role);
    if (!q.principal || !isAddress(q.principal) || !role) return reply.code(400).send({ error: "BAD_REQUEST", message: "principal address and role=creator|merchant required" });
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 50);
    const me = q.principal.toLowerCase();
    const [offers, campaigns] = await Promise.all([listLiveOffers(d.arkiv), listCampaigns(d.arkiv, { limit: 100 }, now())]);
    const byId = new Map(campaigns.map((c) => [c.campaignId.toString(), c]));
    const cache = new Map();
    const out: ReturnType<typeof summary>[] = [];
    for (const offer of offers) {
      if (out.length >= limit) break;
      if (role === "creator" && offer.creator.toLowerCase() !== me) continue;
      const camp = byId.get(offer.campaignId.toString());
      if (!camp) continue;
      if (role === "merchant" && (await merchantOf(offer.campaignId))?.toLowerCase() !== me) continue;
      const t = await loadThread({ arkiv: d.arkiv, merchantOf }, offer, { commissionBps: Number(camp.commissionBps), category: camp.category }, cache);
      if (t) out.push(summary(t, camp.name));
    }
    out.sort((a, b) => b.round - a.round);
    return ser(out);
  });

  /** Is this principal's agent connected? True when a live numa.agent entity owned by the principal names the API's agent wallet. */
  app.get("/agents/binding", async (req, reply) => {
    const q = req.query as { principal?: string; role?: string };
    const role = roleOf(q.role);
    if (!q.principal || !isAddress(q.principal) || !role) return reply.code(400).send({ error: "BAD_REQUEST", message: "principal address and role=creator|merchant required" });
    const bindings = await listAgentBindings(d.arkiv, q.principal, role);
    const agent = d.agentAddress?.toLowerCase();
    return ser({
      enabled: !!d.agentAddress, agentAddress: d.agentAddress ?? null, principal: q.principal, role,
      bound: !!agent && bindings.some((b) => b.agent.toLowerCase() === agent),
      bindings: bindings.map((b) => ({ agent: b.agent, entityKey: b.entityKey })),
    });
  });

  /** Public, verified negotiation thread for one offer (everything here is already public on Arkiv). */
  app.get("/agents/threads/:offerKey", async (req, reply) => {
    const { offerKey } = req.params as { offerKey: string };
    if (!isHex(offerKey)) return reply.code(400).send({ error: "BAD_REQUEST" });
    const [offers, campaigns] = await Promise.all([listLiveOffers(d.arkiv), listCampaigns(d.arkiv, { limit: 100 }, now())]);
    const offer = offers.find((o) => o.entityKey.toLowerCase() === offerKey.toLowerCase());
    const camp = offer && campaigns.find((c) => c.campaignId === offer.campaignId);
    if (!offer || !camp) return reply.code(404).send({ error: "NOT_FOUND", message: "offer not live" });
    const t = await loadThread({ arkiv: d.arkiv, merchantOf }, offer, { commissionBps: Number(camp.commissionBps), category: camp.category });
    if (!t) return reply.code(404).send({ error: "UNVERIFIED_MERCHANT", message: "campaign merchant could not be confirmed on-chain" });
    return ser({ offerKey: t.offerKey, campaignId: t.campaignId, creator: t.creator, merchant: t.merchant, offerAskBps: t.offerAskBps, state: t.state, messages: t.verified });
  });

  /** Deals reached for a merchant, with the on-chain step the merchant must sign. The agent never signs these. */
  app.get("/agents/deals", async (req, reply) => {
    const { merchant } = req.query as { merchant?: string };
    if (!merchant || !isAddress(merchant)) return reply.code(400).send({ error: "BAD_REQUEST", message: "merchant address required" });
    const [offers, campaigns] = await Promise.all([listLiveOffers(d.arkiv), listCampaigns(d.arkiv, { limit: 100 }, now())]);
    const cache = new Map();
    const out: unknown[] = [];
    for (const offer of offers) {
      const camp = campaigns.find((c) => c.campaignId === offer.campaignId);
      if (!camp) continue;
      const t = await loadThread({ arkiv: d.arkiv, merchantOf }, offer, { commissionBps: Number(camp.commissionBps), category: camp.category }, cache);
      if (!t || t.merchant.toLowerCase() !== merchant.toLowerCase() || t.state.kind !== "deal") continue;
      const chain = await d.pub.readContract({ address: d.registry, abi: campaignRegistryAbi, functionName: "getCampaign", args: [t.campaignId] });
      const agreed = t.state.bps;
      const sameRate = Number(chain.commissionBps) === agreed;
      out.push({
        offerKey: t.offerKey, campaignId: t.campaignId, creator: t.creator, agreedBps: agreed,
        // The rate lives on the campaign (ADR 0006): reuse it if it already matches, otherwise a dedicated campaign is needed first.
        steps: sameRate
          ? [{ to: d.registry, description: "approve the creator on the existing campaign", data: encodeFunctionData({ abi: CampaignRegistryAbi, functionName: "approveCreator", args: [t.campaignId, t.creator] }) }]
          : [
            { to: d.registry, description: `create a campaign at ${agreed / 100}% (same payout signer and end date)`, data: encodeFunctionData({ abi: CampaignRegistryAbi, functionName: "createCampaign", args: [chain.payoutSigner, BigInt(agreed), chain.endsAt] }) },
            { to: d.registry, description: "then approve the creator on the NEW campaign id (read it from the CampaignCreated event)", data: null },
          ],
      });
    }
    return ser(out);
  });
}
