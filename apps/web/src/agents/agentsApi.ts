import { API_BASE, ApiError, getJson } from "../api/client";
import type { PolicyBody } from "./policyForm";
import type { AgentRole } from "@numa/shared";

/** Shapes of the `/agents/*` endpoints (docs/API.md, "Negotiation agents"). bigints arrive as strings. */

export interface AgentStatus {
  enabled: boolean;
  agentAddress: string | null;
}

export interface AgentBindingInfo {
  enabled: boolean;
  agentAddress: string | null;
  principal: string;
  role: AgentRole;
  /** true only when a live binding owned by the principal names the API's agent wallet */
  bound: boolean;
  bindings: { agent: string; entityKey: string }[];
}

export type ThreadState = "open" | "deal" | "rejected";
export type NegotiationAction = "propose" | "counter" | "accept" | "reject";

export interface ThreadSummary {
  offerKey: string;
  campaignId: string;
  campaignName?: string;
  creator: string;
  merchant: string;
  offerAskBps: number;
  state: ThreadState;
  agreedBps?: number;
  round: number;
  messageCount: number;
  /** messages in the thread that failed verification and were dropped */
  ignoredMessages: number;
  last?: { from: AgentRole; action: NegotiationAction; bps: number; note: string; seq: number };
}

export interface ThreadMessage {
  entityKey: string;
  owner: string;
  from: AgentRole;
  seq: number;
  action: NegotiationAction;
  bps: number;
  /** counterparty-written text: untrusted, always rendered as plain text */
  note: string;
  verifiedOwner: boolean;
}

export interface ThreadDetail {
  offerKey: string;
  campaignId: string;
  creator: string;
  merchant: string;
  offerAskBps: number;
  state: { kind: ThreadState; seq?: number; bps?: number };
  messages: ThreadMessage[];
}

export interface DealStep {
  to: string;
  description: string;
  /** calldata, or null when the step can't be pre-built (needs an id from a previous step) */
  data: string | null;
}
export interface DealTicket {
  offerKey: string;
  campaignId: string;
  creator: string;
  agreedBps: number;
  steps: DealStep[];
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const agentsApi = {
  status: (signal?: AbortSignal) => getJson<AgentStatus>("/agents/status", { signal }),
  binding: (principal: string, role: AgentRole, signal?: AbortSignal) =>
    getJson<AgentBindingInfo>(`/agents/binding?${q({ principal, role })}`, { signal }),
  threads: (principal: string, role: AgentRole, signal?: AbortSignal) =>
    getJson<ThreadSummary[]>(`/agents/threads?${q({ principal, role, limit: "50" })}`, { signal }),
  thread: (offerKey: string, signal?: AbortSignal) =>
    getJson<ThreadDetail>(`/agents/threads/${offerKey}`, { signal }),
  deals: (merchant: string, signal?: AbortSignal) =>
    getJson<DealTicket[]>(`/agents/deals?${q({ merchant })}`, { signal }),
};

export class PolicyApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PolicyApiError";
  }
}

async function postJson<T>(path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PolicyApiError("NETWORK", "The API is unreachable.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new PolicyApiError(data.error ?? `HTTP_${res.status}`, data.message ?? `The API answered ${res.status}.`, res.status);
  return data as T;
}

/** Save the private policy. `signature` is the principal's EIP-191 signature over the matching `writeRequest` message. */
export const savePolicy = (payload: { policy: PolicyBody; issuedAt: number }, signature: string, fetchImpl?: typeof fetch) =>
  postJson<{ ok: true; enabled: boolean }>("/agents/policy", { ...payload, signature }, fetchImpl);

/** Read the principal's own policy back. 404 NOT_FOUND means none saved yet. */
export const readPolicy = (payload: { principal: string; role: AgentRole; issuedAt: number }, signature: string, fetchImpl?: typeof fetch) =>
  postJson<PolicyBody>("/agents/policy/read", { ...payload, signature }, fetchImpl);

export { ApiError };
