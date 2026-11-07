import type { OrderPayload } from "./signing";

/**
 * The two HTTP calls of a checkout:
 *   - the merchant's order endpoint (their server signs the order with the campaign's payout key,
 *     e.g. with @numa/sdk-server), and
 *   - the relayer's `/relay`.
 * Both take a full URL, so a merchant can point them anywhere. Failures carry the relayer's own
 * error code, or NETWORK / HTTP_<status>.
 */
export class CheckoutApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CheckoutApiError";
  }
}

export interface CallOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function post<T>(url: string, body: unknown, opts: CallOptions, defaultTimeout: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), opts.timeoutMs ?? defaultTimeout);
  opts.signal?.addEventListener("abort", () => ctrl.abort(opts.signal?.reason));
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    // A timeout after the request was sent means we cannot know whether it was processed.
    throw new CheckoutApiError("NETWORK", ctrl.signal.reason === "timeout" ? "The API timed out." : "The API is unreachable.");
  } finally {
    clearTimeout(timer);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new CheckoutApiError(`HTTP_${res.status}`, `The API answered ${res.status}.`, res.status);
    throw new CheckoutApiError("INTERNAL", "The API returned a response that isn't JSON.", res.status);
  }
  if (!res.ok) {
    const d = data as { error?: unknown; message?: unknown };
    const code = typeof d.error === "string" ? d.error : `HTTP_${res.status}`;
    throw new CheckoutApiError(code, typeof d.message === "string" ? d.message : code, res.status);
  }
  return data as T;
}

export interface CreateOrderBody {
  campaignId: string;
  creator: string;
  buyer: string;
  amount: string;
}

export const createOrder = (url: string, body: CreateOrderBody, opts: CallOptions = {}) =>
  post<OrderPayload>(url, body, opts, 15_000);

export interface RelayResult {
  status: "settled";
  txHash: string;
  blockNumber: string;
}

/** The relayer waits for the receipt, so allow it a long time before giving up. */
export const relayOrder = (url: string, body: unknown, opts: CallOptions = {}) =>
  post<RelayResult>(url, body, opts, 120_000);
