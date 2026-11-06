import type { Policy, Role } from "./policy.js";

export type Action = "propose" | "counter" | "accept" | "reject";
/** A verified message (owner already checked by the caller). */
export interface Msg { from: Role; seq: number; action: Action; bps: number }
export interface Decision { action: Action; bps: number; reason: string }

export type ThreadState =
  | { kind: "open"; last?: Msg; seq: number }
  | { kind: "deal"; bps: number; seq: number }
  | { kind: "rejected"; seq: number };

/**
 * Folds verified messages into a state. Rounds must be consecutive and alternate between roles; an `accept` only
 * counts if it names exactly the other side's last position. Anything else is ignored, so spam cannot move a thread.
 */
export function threadState(msgs: Msg[], offerAskBps: number): ThreadState {
  let seq = 0;
  let last: Msg | undefined;
  for (const m of [...msgs].sort((a, b) => a.seq - b.seq)) {
    if (m.seq !== seq + 1) continue;
    if (last && m.from === last.from) continue;
    if (!last && m.from !== "merchant") continue; // the creator's offer is round 0; the merchant speaks first
    if (m.action === "reject") return { kind: "rejected", seq: m.seq };
    if (m.action === "accept") {
      const theirs = last ? last.bps : offerAskBps;
      if (m.bps !== theirs) continue;
      return { kind: "deal", bps: m.bps, seq: m.seq };
    }
    if ((m.action === "propose" || m.action === "counter") && m.bps >= 0 && m.bps <= 5000) { last = m; seq = m.seq; }
  }
  return { kind: "open", ...(last && { last }), seq };
}

export interface Ctx { state: ThreadState; offerAskBps: number; campaignCapBps: number; myMessages: number; myLastBps: number | undefined }

/** Pure policy decision. Returns null when it is not this agent's turn or the thread is closed. */
export function decide(p: Policy, c: Ctx): Decision | null {
  if (!p.enabled || c.state.kind !== "open") return null;
  const last = c.state.last;
  if (last && last.from === p.role) return null; // waiting for the counterparty
  return p.role === "merchant" ? merchant(p, c, last) : creator(p, c, last);
}

function merchant(p: Policy, c: Ctx, last: Msg | undefined): Decision {
  const limit = Math.min(p.limitBps, c.campaignCapBps);
  const ask = last ? last.bps : c.offerAskBps; // the creator's current position
  if (ask <= p.autoAcceptBps && ask <= limit) return { action: "accept", bps: ask, reason: "within auto-accept" };
  if (c.myMessages >= p.maxRounds) return ask <= limit ? { action: "accept", bps: ask, reason: "final round, within ceiling" } : { action: "reject", bps: ask, reason: "above ceiling after max rounds" };
  const next = c.myLastBps === undefined ? Math.min(p.openingBps, limit) : Math.min(limit, c.myLastBps + p.stepBps);
  if (next >= ask && ask <= limit) return { action: "accept", bps: ask, reason: "creator's ask is within reach" };
  // At the ceiling and the ask is still above it: hold firm (repeat the ceiling) until maxRounds ends it.
  const holding = c.myLastBps !== undefined && next === c.myLastBps;
  return { action: c.myLastBps === undefined ? "propose" : "counter", bps: next, reason: holding ? "holding at my ceiling" : "moving toward the creator's ask" };
}

function creator(p: Policy, c: Ctx, last: Msg | undefined): Decision | null {
  if (!last) return null; // merchant has not spoken yet
  const offer = last.bps; // the merchant's current position
  if (offer >= p.autoAcceptBps) return { action: "accept", bps: offer, reason: "within auto-accept" };
  if (c.myMessages >= p.maxRounds) return offer >= p.limitBps ? { action: "accept", bps: offer, reason: "final round, above floor" } : { action: "reject", bps: offer, reason: "below floor after max rounds" };
  const mine = c.myLastBps ?? c.offerAskBps;
  const next = Math.max(p.limitBps, mine - p.stepBps);
  if (offer >= next && offer >= p.limitBps) return { action: "accept", bps: offer, reason: "merchant met my next position" };
  // At the floor and the offer is still below it: hold firm (repeat the floor) until maxRounds ends it.
  return { action: "counter", bps: next, reason: next === mine ? "holding at my floor" : "conceding toward the merchant" };
}
