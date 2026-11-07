import { isAddress, type Address } from "viem";
import { parseUsdtAmount, SigningError } from "./signing";

export interface CheckoutParams {
  campaignId: string;
  creator: Address;
  amount: string;
}

export type ParamsResult = { ok: true; params: CheckoutParams } | { ok: false; reason: string };

/**
 * `/checkout/:code?campaign=7&creator=0x…&amount=25.00`
 * The order service resolves nothing from the code yet (there is no link-resolution endpoint),
 * so the merchant's page supplies campaign, creator and amount. Every value is validated here and
 * again on the server; a malformed or missing one means we do not start a real payment.
 */
export function parseCheckoutParams(search: string): ParamsResult {
  const q = new URLSearchParams(search);
  const campaignId = q.get("campaign") ?? "";
  const creator = q.get("creator") ?? "";
  const amount = q.get("amount") ?? "";
  if (!/^\d{1,18}$/.test(campaignId)) return { ok: false, reason: "missing or invalid campaign id" };
  if (!isAddress(creator)) return { ok: false, reason: "missing or invalid creator address" };
  try {
    parseUsdtAmount(amount);
  } catch (e) {
    return { ok: false, reason: e instanceof SigningError ? "missing or invalid amount" : "invalid amount" };
  }
  return { ok: true, params: { campaignId, creator: creator as Address, amount } };
}
