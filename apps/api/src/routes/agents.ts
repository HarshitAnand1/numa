import type { FastifyInstance } from "fastify";
import { encodeFunctionData, isAddress, isHex, type Address, type Hex, type PublicClient } from "viem";
import { campaignRegistryAbi, CampaignRegistryAbi } from "@numa/shared";
import { listCampaigns, listLiveOffers, type ArkivReader } from "@numa/arkiv";
import { loadThread } from "../agents/runner.js";
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
