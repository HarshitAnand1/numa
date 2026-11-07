import type { SigningErrorCode } from "./signing";

/**
 * Plain-language messages for everything that can go wrong between "pay" and "settled".
 * The thing a buyer cares about is whether money moved, so every entry says so.
 * `retry` is false whenever retrying blindly could double-submit.
 */
export interface FailureInfo {
  title: string;
  message: string;
  /** "no" = provably nothing was charged; "unknown" = check the explorer before doing anything */
  moneyMoved: "no" | "unknown";
  /** safe to simply try again */
  retry: boolean;
}

const relayer: Record<string, FailureInfo> = {
  ORDER_EXPIRED: {
    title: "this order expired.",
    message: "It timed out before it was sent. Nothing was charged. Start the payment again for a fresh order.",
    moneyMoved: "no",
    retry: true,
  },
  BAD_AUTH_WINDOW: {
    title: "the authorization window closed.",
    message: "Your signature was valid for a short time and that time ran out. Nothing was charged. Start again.",
    moneyMoved: "no",
    retry: true,
  },
  BAD_SELF_PURCHASE: {
    title: "you can’t buy through your own link.",
    message: "The buyer can’t be the creator or the merchant of the same order. Nothing was charged.",
    moneyMoved: "no",
    retry: false,
  },
  BAD_MERCHANT_SIG: {
    title: "the merchant’s signature didn’t check out.",
    message: "The order wasn’t signed by the campaign’s payout signer, so the relayer refused it. Nothing was charged.",
    moneyMoved: "no",
    retry: false,
  },
  BAD_BUYER_AUTH: {
    title: "your wallet’s authorization didn’t match.",
    message: "The signature doesn’t belong to this order and wallet. Nothing was charged. Start again.",
    moneyMoved: "no",
    retry: true,
  },
  DUPLICATE: {
    title: "this order was already submitted.",
    message: "Don’t pay again yet. Check your USDT balance and the explorer first: the first attempt may have gone through.",
    moneyMoved: "unknown",
    retry: false,
  },
  GAS_PRICE_TOO_HIGH: {
    title: "the network is too expensive right now.",
    message: "The relayer pauses when gas is unusually high. Nothing was charged. Try again in a few minutes.",
    moneyMoved: "no",
    retry: true,
  },
  DAILY_CAP_EXCEEDED: {
    title: "the relayer hit its daily limit.",
    message: "It sponsors a fixed amount of gas per day and that is used up. Nothing was charged. Try again tomorrow.",
    moneyMoved: "no",
    retry: false,
  },
  ADDRESS_LIMIT_EXCEEDED: {
    title: "too many payments from this wallet today.",
    message: "The relayer limits sponsored payments per wallet. Nothing was charged.",
    moneyMoved: "no",
    retry: false,
  },
  INSUFFICIENT_RELAYER_BALANCE: {
    title: "the relayer is out of gas money.",
    message: "It can’t pay Whitechain fees until it is topped up. Nothing was charged. Tell the merchant.",
    moneyMoved: "no",
    retry: false,
  },
  SIMULATION_FAILED: {
    title: "couldn’t simulate this payment.",
    message: "The relayer tests every payment before sending it, and this one would fail. Check your USDT balance and network. Nothing was charged.",
    moneyMoved: "no",
    retry: true,
  },
  TX_REVERTED: {
    title: "the transaction reverted.",
    message: "It was sent but failed on-chain, so your USDT was not transferred. Check the explorer if you want the details.",
    moneyMoved: "no",
    retry: true,
  },
  TX_TIMEOUT: {
    title: "sent, but not confirmed yet.",
    message: "The payment was submitted but we couldn’t see it confirm in time. Check the explorer before trying again, or you may pay twice.",
    moneyMoved: "unknown",
    retry: false,
  },
  INTERNAL: {
    title: "the relayer had a problem.",
    message: "Something broke on our side. Check the explorer before retrying, in case the payment went through.",
    moneyMoved: "unknown",
    retry: false,
  },
  NETWORK: {
    title: "couldn’t reach the relayer.",
    message: "Your connection or the API is down. If this happened after you signed, check the explorer before paying again.",
    moneyMoved: "unknown",
    retry: false,
  },
};

const signing: Record<SigningErrorCode, FailureInfo> = {
  BAD_AMOUNT: { title: "that amount isn’t valid.", message: "Use a positive amount with at most 6 decimals.", moneyMoved: "no", retry: false },
  BAD_PAYLOAD: { title: "the order looked wrong.", message: "The order service sent something incomplete. You were not asked to sign and nothing was charged.", moneyMoved: "no", retry: true },
  ORDER_MISMATCH: { title: "the order doesn’t match what you asked for.", message: "The amount, creator, campaign or wallet in the order differs from your request, so we stopped before asking you to sign. Nothing was charged.", moneyMoved: "no", retry: false },
  ORDER_EXPIRED: { title: "this order is about to expire.", message: "It would expire before the payment could be sent. Start again for a fresh one. Nothing was charged.", moneyMoved: "no", retry: true },
  MERCHANT_MISMATCH: { title: "the merchant doesn’t match the campaign.", message: "The order names a merchant that isn’t the campaign’s on-chain owner. We stopped before asking you to sign.", moneyMoved: "no", retry: false },
  SIGNER_MISMATCH: { title: "the order wasn’t signed by the campaign.", message: "Its merchant signature doesn’t match the campaign’s payout signer. We stopped before asking you to sign.", moneyMoved: "no", retry: false },
  NONCE_MISMATCH: { title: "the order’s terms don’t match the contracts.", message: "The authorization the server prepared doesn’t match the on-chain split. We refused to sign it. Nothing was charged.", moneyMoved: "no", retry: false },
  CAMPAIGN_NOT_SETTLEABLE: { title: "this campaign can’t take payments.", message: "It is paused, ended, or doesn’t exist on-chain. Nothing was charged.", moneyMoved: "no", retry: false },
  CREATOR_NOT_APPROVED: { title: "this creator isn’t approved here.", message: "The merchant hasn’t approved the creator on this campaign, so the router would reject the sale. Nothing was charged.", moneyMoved: "no", retry: false },
  CONTRACTS_UNAVAILABLE: { title: "couldn’t read the campaign on Whitechain.", message: "The chain didn’t answer. Nothing was charged. Try again.", moneyMoved: "no", retry: true },
  INSUFFICIENT_USDT: { title: "not enough USDT.", message: "Your wallet doesn’t hold enough test USDT for this order. Nothing was charged.", moneyMoved: "no", retry: false },
};

export const WALLET_REJECTED: FailureInfo = {
  title: "you declined the signature.",
  message: "No problem. Nothing was signed and nothing was charged.",
  moneyMoved: "no",
  retry: true,
};

export function describeRelayFailure(code: string): FailureInfo {
  return relayer[code] ?? {
    title: "the payment didn’t go through.",
    message: `The relayer answered with “${code}”. Check the explorer before trying again.`,
    moneyMoved: "unknown",
    retry: false,
  };
}

export function describeSigningFailure(code: SigningErrorCode): FailureInfo {
  return signing[code];
}

export const RELAYER_ERROR_CODES = Object.keys(relayer);
