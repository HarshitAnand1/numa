import { ExpirationTime } from "@arkiv-network/sdk";

/** Chain rule: no entity may live more than ~182 days past the block of its create/extend. */
export const MAX_LIFETIME_SECONDS = 182 * 24 * 60 * 60;
const HOUR = 3600;

function until(unixSeconds: number, nowSeconds: number) {
  const delta = unixSeconds - nowSeconds;
  if (delta <= 0) throw new Error("expiry is in the past");
  if (delta > MAX_LIFETIME_SECONDS) throw new Error(`expiry exceeds the ~182 day Arkiv maximum (${Math.floor(delta / 86400)}d)`);
  return ExpirationTime.atDate(new Date(unixSeconds * 1000));
}

export const expiries = {
  /** Campaign end + 7 days. Campaigns longer than ~175 days cannot be represented. */
  campaign: (endsAt: number, now = Math.floor(Date.now() / 1000)) => until(endsAt + 7 * 24 * HOUR, now),
  /** 72 hours. */
  offer: () => ExpirationTime.fromHours(72),
  /** Campaign end date. */
  decision: (endsAt: number, now = Math.floor(Date.now() / 1000)) => until(endsAt, now),
  /** Chosen by the creator; capped by the chain maximum. */
  link: (days: number) => ExpirationTime.fromDays(days),
  /** 90 days. */
  conversion: () => ExpirationTime.fromDays(90),
};
