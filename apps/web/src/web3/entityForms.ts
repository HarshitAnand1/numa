import { isAddress, type Address } from "viem";
import { MAX_BPS, pctToBps } from "../agents/policyForm";

/**
 * Validation for everything a user publishes: profile, offer, link, campaign. Pure functions.
 * The limits mirror `@numa/arkiv` (checkProfile, link code rule, the ~182-day expiry cap) and the
 * contracts (commission at most 50%). The chain and Arkiv re-validate; this saves a wallet prompt
 * and a gas payment on input that would be refused anyway.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;
export const LINK_CODE = /^[A-Za-z0-9_-]{4,32}$/;
export const DAY = 86_400;
/** Arkiv entities live at most ~182 days; a campaign listing lives until its end + 7 days. */
export const MAX_CAMPAIGN_DAYS = 175;
export const MAX_LINK_DAYS = 182;

export type Errors<K extends string> = Partial<Record<K, string>>;
export type Result<T, K extends string> = { ok: true; value: T } | { ok: false; errors: Errors<K> };

export const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

const int = (s: string, min: number, max: number): number | null => {
  const t = s.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/* ---------------------------------------------------------------- profile */

export interface ProfileForm {
  displayName: string;
  bio: string;
  niche: string;
  niches: string; // comma-separated extras
  channel: string;
  handle: string;
  minAsk: string; // percent
  open: boolean;
}
export interface ProfileValue {
  displayName: string;
  bio: string;
  niche: string;
  niches: string[];
  channel: string;
  handle: string;
  minAskBps: number;
  open: boolean;
}

export const emptyProfile = (): ProfileForm => ({ displayName: "", bio: "", niche: "", niches: "", channel: "", handle: "", minAsk: "10", open: true });

export function validateProfile(f: ProfileForm): Result<ProfileValue, keyof ProfileForm> {
  const errors: Errors<keyof ProfileForm> = {};
  const name = f.displayName.trim();
  if (name.length < 1 || name.length > 60) errors.displayName = "1 to 60 characters.";
  if (f.bio.length > 500) errors.bio = "At most 500 characters.";
  const niche = slugify(f.niche);
  if (!SLUG.test(niche)) errors.niche = "Your main niche, like streetwear or music (2 to 32 letters, numbers, dashes).";
  const channel = slugify(f.channel);
  if (!SLUG.test(channel)) errors.channel = "Your main channel, like youtube or newsletter.";
  const niches = f.niches
    .split(",")
    .map(slugify)
    .filter(Boolean);
  if (niches.some((n) => !SLUG.test(n)) || niches.length > 8) errors.niches = "Up to 8 extra niches, each 2 to 32 letters, numbers or dashes.";
  const minAsk = pctToBps(f.minAsk);
  if (minAsk === null || minAsk > MAX_BPS) errors.minAsk = "A percent from 0 to 50, like 10 or 12.5.";
  if (f.handle.length > 100) errors.handle = "At most 100 characters.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { displayName: name, bio: f.bio.trim(), niche, niches, channel, handle: f.handle.trim(), minAskBps: minAsk as number, open: f.open } };
}

/* ------------------------------------------------------------------ offer */

export const CHANNELS = [
  { value: "short-video", label: "short video" },
  { value: "newsletter", label: "newsletter" },
  { value: "live-stream", label: "live stream" },
  { value: "podcast", label: "podcast" },
] as const;

export interface OfferForm {
  channel: string;
  audience: string;
  askPct: number;
  reach: string;
}
export interface OfferValue {
  channel: string;
  audience: string;
  askBps: number;
  expectedReach: bigint;
}

/** `maxBps` is the campaign's own commission (the ceiling a creator can ask for). */
export function validateOffer(f: OfferForm, maxBps: number): Result<OfferValue, keyof OfferForm> {
  const errors: Errors<keyof OfferForm> = {};
  if (!SLUG.test(f.channel)) errors.channel = "Choose where the product will appear.";
  const audience = f.audience.trim();
  if (audience.length < 10) errors.audience = "Be specific: at least 10 characters.";
  else if (audience.length > 500) errors.audience = "At most 500 characters.";
  const askBps = Math.round(f.askPct * 100);
  if (!Number.isFinite(f.askPct) || askBps < 100) errors.askPct = "Ask at least 1%.";
  else if (askBps > maxBps) errors.askPct = `The campaign pays at most ${maxBps / 100}%.`;
  const reach = int(f.reach, 0, 1_000_000_000);
  if (reach === null) errors.reach = "A whole number, 0 or more.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { channel: f.channel, audience, askBps, expectedReach: BigInt(reach as number) } };
}

/* ------------------------------------------------------------------- link */

export interface LinkForm {
  code: string;
  days: string;
}
export interface LinkValue {
  code: string;
  days: number;
}

/** `campaignDaysLeft` caps the link at the campaign's life. */
export function validateLink(f: LinkForm, campaignDaysLeft: number): Result<LinkValue, keyof LinkForm> {
  const errors: Errors<keyof LinkForm> = {};
  if (!LINK_CODE.test(f.code)) errors.code = "4 to 32 letters, numbers, dashes or underscores.";
  const days = int(f.days, 1, MAX_LINK_DAYS);
  if (days === null) errors.days = `1 to ${MAX_LINK_DAYS} days.`;
  else if (days > campaignDaysLeft) errors.days = `The campaign ends in ${campaignDaysLeft} day${campaignDaysLeft === 1 ? "" : "s"}; a link can't outlive it usefully.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { code: f.code, days: days as number } };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function suggestLinkCode(rand: () => number = Math.random, length = 8): string {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

/** The public click-tracker URL for a link code (the API serves `/r/:code`). */
export function trackerUrl(code: string, origin: string, apiBase: string): string {
  return apiBase.startsWith("/") ? `${origin}${apiBase}/r/${code}` : `${apiBase}/r/${code}`;
}

export interface SavedLink {
  code: string;
  campaignId: string;
  days: number;
  createdAt: number;
}

/**
 * Link codes are public, so a creator's list lives in this browser's storage (Arkiv owns the links; the
 * API can't list a creator's own). `storage` is injected so it can be tested and so a blocked or full
 * storage never breaks the page.
 */
export function makeLinkStore(storage: Pick<Storage, "getItem" | "setItem"> | undefined) {
  const key = (a: string) => `numa:links:${a.toLowerCase()}`;
  const valid = (x: unknown): x is SavedLink => {
    const o = x as SavedLink;
    return !!o && typeof o.code === "string" && LINK_CODE.test(o.code) && typeof o.campaignId === "string" && /^\d+$/.test(o.campaignId) && Number.isFinite(o.days) && Number.isFinite(o.createdAt);
  };
  return {
    list(address: string): SavedLink[] {
      try {
        const raw = storage?.getItem(key(address));
        const arr: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(valid) : [];
      } catch {
        return [];
      }
    },
    add(address: string, link: SavedLink): SavedLink[] {
      const next = [link, ...this.list(address).filter((l) => l.code !== link.code)].slice(0, 50);
      try {
        storage?.setItem(key(address), JSON.stringify(next));
      } catch {
        /* storage blocked or full: the link still exists on Arkiv */
      }
      return next;
    },
  };
}

/* --------------------------------------------------------------- campaign */

export interface CampaignForm {
  name: string;
  description: string;
  category: string;
  region: string;
  commission: string; // percent
  days: string;
  payoutSigner: string;
}
export interface CampaignValue {
  payoutSigner: Address;
  commissionBps: number;
  endsAt: number;
  listing: { name: string; description: string; category: string; region: string };
}

export const emptyCampaign = (payoutSigner = ""): CampaignForm => ({ name: "", description: "", category: "", region: "global", commission: "15", days: "30", payoutSigner });

export function validateCampaign(f: CampaignForm, now = Math.floor(Date.now() / 1000)): Result<CampaignValue, keyof CampaignForm> {
  const errors: Errors<keyof CampaignForm> = {};
  const name = f.name.trim();
  if (name.length < 1 || name.length > 80) errors.name = "1 to 80 characters.";
  if (f.description.length > 280) errors.description = "At most 280 characters.";
  const category = slugify(f.category);
  if (!SLUG.test(category)) errors.category = "A category creators can filter by, like streetwear or music.";
  const region = slugify(f.region);
  if (!SLUG.test(region)) errors.region = "Like global, us or eu.";
  const bps = pctToBps(f.commission);
  if (bps === null || bps < 1) errors.commission = "A percent from 0.01 to 50.";
  else if (bps > MAX_BPS) errors.commission = "The contracts cap commission at 50%.";
  const days = int(f.days, 1, MAX_CAMPAIGN_DAYS);
  if (days === null) errors.days = `1 to ${MAX_CAMPAIGN_DAYS} days (Arkiv keeps a listing at most ~182 days past its end).`;
  if (!isAddress(f.payoutSigner)) errors.payoutSigner = "The address of the key your order server signs with. It can be your own wallet.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      payoutSigner: f.payoutSigner as Address,
      commissionBps: bps as number,
      endsAt: now + (days as number) * DAY,
      listing: { name, description: f.description.trim(), category, region },
    },
  };
}
