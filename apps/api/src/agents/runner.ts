import type { Address, Hex } from "viem";
import {
  isAuthorized, listAgentBindings, listCampaigns, listLiveOffers, listNegotiation, publishNegotiationMessage,
  type AgentBinding, type ArkivReader, type ArkivWriter, type NegotiationMessage,
} from "@numa/arkiv";
import { decide, threadState, type Msg, type ThreadState } from "./engine.js";
import type { NoteWriter } from "./llm.js";
import type { Policy, Role } from "./policy.js";
import type { PolicyStore } from "./store.js";

export interface RunnerDeps {
  arkiv: ArkivReader;
  /** The agent wallet. It only writes Arkiv entities; it holds no authority over funds. */
  writer: ArkivWriter;
  agentAddress: Address;
  store: PolicyStore;
  notes: NoteWriter;
  /** On-chain merchant of a campaign (the authority), or null if unknown. Unknown merchants are never acted for. */
  merchantOf: (campaignId: bigint) => Promise<Address | null>;
  now?: () => number;
  log?: (o: Record<string, unknown>) => void;
}

export interface Thread {
  offerKey: Hex; campaignId: bigint; creator: Address; merchant: Address; offerAskBps: number;
  campaignCapBps: number; category: string; messages: Msg[]; state: ThreadState;
  /** Verified messages with who wrote them, for display. */
  verified: (NegotiationMessage & { verifiedOwner: boolean })[];
}

/** Reads one thread from Arkiv and keeps only messages written by the right principal or its bound agent. */
export async function loadThread(
  d: Pick<RunnerDeps, "arkiv" | "merchantOf">,
  offer: { entityKey: Hex; creator: Address; campaignId: bigint; askBps: number },
  campaign: { commissionBps: number; category: string },
  bindingCache = new Map<string, Promise<AgentBinding[]>>(),
): Promise<Thread | null> {
  const merchant = await d.merchantOf(offer.campaignId);
  if (!merchant) return null;
  const bindings = async (p: Address, role: Role) => {
    const key = `${p.toLowerCase()}:${role}`;
    if (!bindingCache.has(key)) bindingCache.set(key, listAgentBindings(d.arkiv, p, role));
    return bindingCache.get(key)!;
  };
  const raw = await listNegotiation(d.arkiv, offer.entityKey);
  const [cb, mb] = await Promise.all([bindings(offer.creator, "creator"), bindings(merchant, "merchant")]);
  const verified = raw
    .filter((m) => m.creator.toLowerCase() === offer.creator.toLowerCase() && m.merchant.toLowerCase() === merchant.toLowerCase() && m.campaignId === offer.campaignId)
    .map((m) => ({ ...m, verifiedOwner: m.from === "creator" ? isAuthorized(m.owner, offer.creator, "creator", cb) : isAuthorized(m.owner, merchant, "merchant", mb) }));
  const messages: Msg[] = verified.filter((m) => m.verifiedOwner).map((m) => ({ from: m.from, seq: m.seq, action: m.action, bps: m.bps }));
  return {
    offerKey: offer.entityKey, campaignId: offer.campaignId, creator: offer.creator, merchant, offerAskBps: offer.askBps,
    campaignCapBps: campaign.commissionBps, category: campaign.category, messages, state: threadState(messages, offer.askBps), verified,
  };
}

export class AgentRunner {
  constructor(private readonly d: RunnerDeps) {}

  /** One pass over live offers. Returns the number of messages published. Never throws for a single bad thread. */
  async tick(): Promise<number> {
    const policies = await this.d.store.listEnabled();
    if (!policies.length) return 0;
    const now = (this.d.now ?? (() => Math.floor(Date.now() / 1000)))();
    const [offers, campaigns] = await Promise.all([listLiveOffers(this.d.arkiv), listCampaigns(this.d.arkiv, { limit: 100 }, now)]);
    const byId = new Map(campaigns.map((c) => [c.campaignId.toString(), c]));
    const cache = new Map<string, Promise<AgentBinding[]>>();
    let sent = 0;
    for (const offer of offers) {
      const camp = byId.get(offer.campaignId.toString());
      if (!camp) continue;
      try {
        const thread = await loadThread(this.d, offer, { commissionBps: Number(camp.commissionBps), category: camp.category }, cache);
        if (!thread || thread.state.kind !== "open") continue;
        for (const p of policies) {
          if (!this.concerns(p, thread)) continue;
          if (await this.act(p, thread)) { sent++; break; } // one message per thread per tick: re-read before the next round
        }
      } catch (e) {
        this.d.log?.({ agent: "thread-error", offerKey: offer.entityKey, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return sent;
  }

  private concerns(p: Policy, t: Thread): boolean {
    if (p.role === "creator") return p.principal.toLowerCase() === t.creator.toLowerCase();
    if (p.principal.toLowerCase() !== t.merchant.toLowerCase()) return false;
    return p.categories.length === 0 || p.categories.includes(t.category);
  }

  private async act(p: Policy, t: Thread): Promise<boolean> {
    const mine = t.messages.filter((m) => m.from === p.role);
    const decision = decide(p, {
      state: t.state, offerAskBps: t.offerAskBps, campaignCapBps: t.campaignCapBps,
      myMessages: mine.length, myLastBps: mine.at(-1)?.bps,
    });
    if (!decision) return false;
    const seq = t.state.seq + 1;
    const theirs = t.verified.filter((m) => m.verifiedOwner && m.from !== p.role).at(-1);
    const note = await this.d.notes.write({ role: p.role, decision, round: seq, ...(theirs?.note && { counterpartyNote: theirs.note }) });
    await publishNegotiationMessage(this.d.writer, {
      offerKey: t.offerKey, campaignId: t.campaignId, creator: t.creator, merchant: t.merchant, from: p.role, seq, action: decision.action, bps: decision.bps, note,
    });
    this.d.log?.({ agent: "message", offerKey: t.offerKey, role: p.role, seq, action: decision.action, bps: decision.bps, reason: decision.reason });
    return true;
  }
}
