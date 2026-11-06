import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";

export type Role = "creator" | "merchant";

/** Private guardrails. `limitBps` is the creator's floor or the merchant's ceiling. Never published to Arkiv. */
export interface Policy {
  principal: Address;
  role: Role;
  enabled: boolean;
  limitBps: number;
  /** Merchant: first proposal. Creator: unused (the offer's ask is the opening position). */
  openingBps: number;
  /** Accept immediately at this rate or better (merchant: <= it, creator: >= it). */
  autoAcceptBps: number;
  stepBps: number;
  maxRounds: number;
  /** Merchant only: restrict to these campaign categories (empty = all). */
  categories: string[];
}

const bps = z.number().int().min(0).max(5000);
export const policyInput = z.object({
  principal: z.string().refine(isAddress, "bad address"),
  role: z.enum(["creator", "merchant"]),
  enabled: z.boolean(),
  limitBps: bps, openingBps: bps, autoAcceptBps: bps,
  stepBps: z.number().int().min(10).max(1000),
  maxRounds: z.number().int().min(1).max(10),
  categories: z.array(z.string().regex(/^[a-z0-9-]{2,32}$/)).max(10).default([]),
});

/** Throws a readable error when the guardrails are self-contradictory. */
export function parsePolicy(raw: unknown): Policy {
  const p = policyInput.parse(raw);
  if (p.role === "merchant") {
    if (p.openingBps > p.limitBps) throw new Error("openingBps must be <= limitBps (ceiling)");
    if (p.autoAcceptBps > p.limitBps) throw new Error("autoAcceptBps must be <= limitBps (ceiling)");
  } else if (p.autoAcceptBps < p.limitBps) throw new Error("autoAcceptBps must be >= limitBps (floor)");
  return { ...p, principal: getAddress(p.principal) };
}

export const AUTH_WINDOW_SECONDS = 300;
/** The exact text a principal signs (EIP-191) to read or change their policy. */
export function policyAuthMessage(action: "write" | "read", principal: string, role: Role, issuedAt: number, body: unknown): string {
  return `numa-agent:v1\naction:${action}\nprincipal:${principal.toLowerCase()}\nrole:${role}\nissuedAt:${issuedAt}\nbody:${JSON.stringify(body ?? null)}`;
}

/** Proves the caller controls `principal`. Rejects stale signatures. */
export async function verifyPolicyAuth(a: { action: "write" | "read"; principal: Address; role: Role; issuedAt: number; body?: unknown; signature: Hex; now?: number }) {
  const now = a.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - a.issuedAt) > AUTH_WINDOW_SECONDS) return false;
  return verifyMessage({ address: a.principal, message: policyAuthMessage(a.action, a.principal, a.role, a.issuedAt, a.body), signature: a.signature }).catch(() => false);
}
