import type {
  ApiCampaign,
  ApiCreatorCard,
  ApiInvite,
  ApiLeaderboardRow,
  ApiLedger,
  ApiLinkStats,
  ApiReceipt,
  ApiRecommendation,
  ApiReputation,
  ApiTrending,
} from "./types";

/**
 * Typed client for apps/api (docs/API.md). Base URL is `/api` (proxied to the API by Vite in
 * dev) unless VITE_API_URL points at a deployed API. Failures throw `ApiError` so callers can
 * tell "API unreachable / not enabled" (fall back to demo data, clearly labelled) apart from
 * "API answered with an empty list" (show an honest empty state).
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "http" | "timeout" | "shape",
    readonly status?: number,
    /** the API's own `error` string, when it sent one (e.g. "no profile published for this creator") */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_BASE: string = (import.meta.env?.VITE_API_URL as string | undefined) ?? "/api";
const TIMEOUT_MS = 6000;

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export async function getJson<T>(
  path: string,
  opts: { signal?: AbortSignal; base?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
  opts.signal?.addEventListener("abort", () => ctrl.abort(opts.signal?.reason));
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${opts.base ?? API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e; // caller cancelled: not an API failure
    throw new ApiError(
      ctrl.signal.reason === "timeout" ? "API timed out" : "API unreachable",
      ctrl.signal.reason === "timeout" ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { error?: unknown }) => (typeof b?.error === "string" ? b.error : undefined))
      .catch(() => undefined);
    throw new ApiError(`API ${res.status}`, "http", res.status, detail);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    // A dev server or CDN answering with index.html means the API is not there.
    throw new ApiError("API returned a non-JSON response", "shape", res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("API returned invalid JSON", "shape", res.status);
  }
}

export interface CampaignQuery {
  category?: string;
  region?: string;
  minCommissionBps?: number;
  sort?: "commission" | "endingSoon";
  limit?: number;
}

export const api = {
  campaigns: (q: CampaignQuery = {}, signal?: AbortSignal) =>
    getJson<ApiCampaign[]>(`/discovery/campaigns${qs({ ...q })}`, { signal }),
  trending: (limit = 50, signal?: AbortSignal) =>
    getJson<ApiTrending[]>(`/discovery/trending${qs({ limit })}`, { signal }),
  leaderboard: (q: { campaignId?: string; days?: number; limit?: number } = {}, signal?: AbortSignal) =>
    getJson<ApiLeaderboardRow[]>(`/discovery/leaderboard${qs({ ...q })}`, { signal }),
  creator: (address: string, signal?: AbortSignal) =>
    getJson<ApiCreatorCard>(`/creators/${address}`, { signal }),
  recommendations: (address: string, signal?: AbortSignal) =>
    getJson<ApiRecommendation[]>(`/creators/${address}/recommendations`, { signal }),
  invites: (address: string, signal?: AbortSignal) =>
    getJson<ApiInvite[]>(`/creators/${address}/invites`, { signal }),
  linkStats: (code: string, creator: string, campaignId: string, signal?: AbortSignal) =>
    getJson<ApiLinkStats>(`/links/${encodeURIComponent(code)}/stats${qs({ creator, campaignId })}`, { signal }),
  receipt: (orderId: string, signal?: AbortSignal) => getJson<ApiReceipt>(`/receipts/${orderId}`, { signal }),
  merchantOrders: (address: string, signal?: AbortSignal) => getJson<ApiLedger>(`/merchants/${address}/orders`, { signal }),
  reputation: (address: string, signal?: AbortSignal) =>
    getJson<ApiReputation & { rejected: unknown[] }>(`/creators/${address}/reputation`, { signal }),
};
