/**
 * The exact text a creator or merchant signs (EIP-191 `personal_sign`) to read or change their private
 * negotiation-agent policy. The browser and the API MUST both build it with this function: a single differing
 * character makes every save fail as unauthorized. A fixed test vector in tests/agent-auth.test.ts pins the format.
 */
export type AgentRole = "creator" | "merchant";
export type PolicyAuthAction = "write" | "read";

/** A signature older (or newer) than this many seconds is rejected. */
export const AGENT_AUTH_WINDOW_SECONDS = 300;

/** JSON with object keys sorted recursively, so the signed body does not depend on key insertion order. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export function policyAuthMessage(action: PolicyAuthAction, principal: string, role: AgentRole, issuedAt: number, body?: unknown): string {
  return `numa-agent:v1\naction:${action}\nprincipal:${principal.toLowerCase()}\nrole:${role}\nissuedAt:${issuedAt}\nbody:${canonicalJson(body ?? null)}`;
}
