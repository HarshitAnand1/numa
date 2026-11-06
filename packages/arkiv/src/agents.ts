import { asc, eq } from "@arkiv-network/sdk/query";
import { addr, key as keyVal, u64 } from "@arkiv-network/sdk/schema";
import { ExpirationTime } from "@arkiv-network/sdk";
import type { Address, Hex } from "viem";
import type { ArkivReader, ArkivWriter } from "./client.js";
import type { PublishResult } from "./entities.js";
import { AgentBindingSchema, NegotiationSchema } from "./schemas.js";

export type Role = "creator" | "merchant";
export type NegotiationAction = "propose" | "counter" | "accept" | "reject";

export interface AgentBinding { entityKey: Hex; principal: Address; agent: Address; role: Role }
export interface NegotiationMessage {
  entityKey: Hex; owner: Address; offerKey: Hex; campaignId: bigint; creator: Address; merchant: Address;
  from: Role; seq: number; action: NegotiationAction; bps: number; note: string;
}

const MAX_NOTE = 400;
export const ACTIONS: readonly NegotiationAction[] = ["propose", "counter", "accept", "reject"];

/** Principal wallet: authorize `agent` to write negotiation messages for `role`. 30 days; delete the entity to revoke. */
export async function publishAgentBinding(w: ArkivWriter, b: { agent: Address; role: Role }): Promise<PublishResult> {
  if (b.role !== "creator" && b.role !== "merchant") throw new Error("role must be creator or merchant");
  return w.createEntity(AgentBindingSchema, { agent: addr(b.agent), role: b.role }, { expiration: ExpirationTime.fromDays(30) });
}

/** Live bindings for `role` published BY `principal` (ownedBy filter: a binding from anyone else is ignored). */
export async function listAgentBindings(r: ArkivReader, principal: Address, role: Role): Promise<AgentBinding[]> {
  const res = await r.select().from(AgentBindingSchema).where(eq("role", role)).ownedBy(principal).limit(100).fetch();
  return res.entities.map((e) => ({ entityKey: e.$key as Hex, principal, agent: String(e.agent.value) as Address, role: String(e.role.value) as Role }));
}

/** Is `wallet` allowed to speak for `principal` in `role`? The principal itself always is. */
export function isAuthorized(wallet: string, principal: string, role: Role, bindings: AgentBinding[]): boolean {
  const w = wallet.toLowerCase();
  if (w === principal.toLowerCase()) return true;
  return bindings.some((b) => b.agent.toLowerCase() === w && b.role === role && b.principal.toLowerCase() === principal.toLowerCase());
}

/** Agent or principal wallet. Expires with the 72h offer window. */
export async function publishNegotiationMessage(
  w: ArkivWriter,
  m: { offerKey: Hex; campaignId: bigint; creator: Address; merchant: Address; from: Role; seq: number; action: NegotiationAction; bps: number; note?: string },
): Promise<PublishResult> {
  if (!ACTIONS.includes(m.action)) throw new Error("bad action");
  if (!Number.isInteger(m.seq) || m.seq < 1 || m.seq > 20) throw new Error("seq must be 1..20");
  if (!Number.isInteger(m.bps) || m.bps < 0 || m.bps > 10_000) throw new Error("bps must be 0..10000");
  return w.createEntity(
    NegotiationSchema,
    {
      offerKey: keyVal(m.offerKey), campaignId: u64(m.campaignId), creator: addr(m.creator), merchant: addr(m.merchant),
      from: m.from, seq: u64(BigInt(m.seq)), action: m.action, bps: u64(BigInt(m.bps)), note: (m.note ?? "").slice(0, MAX_NOTE),
    },
    { expiration: ExpirationTime.fromHours(72) },
  );
}

/** Raw (unverified) messages of one thread, in round order. Callers must verify owners with `isAuthorized`. */
export async function listNegotiation(r: ArkivReader, offerKey: Hex, limit = 50): Promise<NegotiationMessage[]> {
  const res = await r.select().from(NegotiationSchema).where(eq("offerKey", keyVal(offerKey))).orderBy(asc("seq")).limit(limit).fetch();
  return res.entities.map((e) => ({
    entityKey: e.$key as Hex, owner: String(e.$owner) as Address, offerKey, campaignId: BigInt(e.campaignId.value as bigint),
    creator: String(e.creator.value) as Address, merchant: String(e.merchant.value) as Address,
    from: String(e.from.value) as Role, seq: Number(e.seq.value), action: String(e.action.value) as NegotiationAction,
    bps: Number(e.bps.value), note: String(e.note.value),
  }));
}
