import type { Address, Hex } from "viem";
import { loadArkiv, onArkiv, writerFor, type ArkivStep } from "./arkivWallet";
import type { LinkValue, OfferValue, ProfileValue } from "./entityForms";

/**
 * Everything a user publishes to Arkiv, as thin wrappers over `@numa/arkiv`. Each one is a transaction
 * signed by the user's own wallet (owner = that wallet, which is the whole point of Arkiv's model),
 * so nobody else, including numa, can publish or withdraw it on their behalf.
 */

type Opts = { onStep?: (s: ArkivStep) => void };
const noop = () => undefined;

export const publishMyProfile = (a: { address: Address; profile: ProfileValue } & Opts) =>
  onArkiv(a.onStep ?? noop, (arkiv, p) => arkiv.publishProfile(writerFor(arkiv, p, a.address), a.profile));

/** Change availability / minimum ask on the profile that already exists (no duplicate entity). */
export const updateMyProfile = (a: { address: Address; entityKey: string; open: boolean; minAskBps: number } & Opts) =>
  onArkiv(a.onStep ?? noop, async (arkiv, p) => {
    await arkiv.setProfileAvailability(writerFor(arkiv, p, a.address), a.entityKey as Hex, { open: a.open, minAskBps: a.minAskBps });
  });

export const renewMyProfile = (a: { address: Address; entityKey: string } & Opts) =>
  onArkiv(a.onStep ?? noop, async (arkiv, p) => {
    await arkiv.renewProfile(writerFor(arkiv, p, a.address), a.entityKey as Hex);
  });

export const publishMyOffer = (a: { address: Address; campaignId: string; offer: OfferValue } & Opts) =>
  onArkiv(a.onStep ?? noop, (arkiv, p) =>
    arkiv.publishOffer(writerFor(arkiv, p, a.address), { campaignId: BigInt(a.campaignId), ...a.offer }),
  );

export const publishMyLink = (a: { address: Address; campaignId: string; link: LinkValue } & Opts) =>
  onArkiv(a.onStep ?? noop, (arkiv, p) =>
    arkiv.publishLink(writerFor(arkiv, p, a.address), { code: a.link.code, campaignId: BigInt(a.campaignId), days: a.link.days }),
  );

export const publishCampaignListing = (
  a: {
    address: Address;
    campaignId: bigint;
    listing: { name: string; description: string; category: string; region: string };
    commissionBps: number;
    endsAt: number;
  } & Opts,
) =>
  onArkiv(a.onStep ?? noop, (arkiv, p) =>
    arkiv.publishCampaign(writerFor(arkiv, p, a.address), { campaignId: a.campaignId, status: "active", commissionBps: a.commissionBps, endsAt: a.endsAt, ...a.listing }),
  );

export const publishMyDecision = (
  a: { address: Address; offerKey: string; campaignId: bigint; result: "approved" | "rejected"; approveTx?: string; campaignEndsAt: number } & Opts,
) =>
  onArkiv(a.onStep ?? noop, (arkiv, p) =>
    arkiv.publishDecision(writerFor(arkiv, p, a.address), {
      offerKey: a.offerKey as Hex,
      campaignId: a.campaignId,
      result: a.result,
      ...(a.approveTx && { approveTx: a.approveTx as Hex }),
      campaignEndsAt: a.campaignEndsAt,
    }),
  );

/* ----------------------------------------------------- public reads (no wallet needed) */

export interface OfferRow {
  entityKey: string;
  creator: string;
  channel: string;
  audience: string;
  askBps: number;
  expectedReach: string;
  /** the merchant's own decision on this offer, if any */
  decision?: "approved" | "rejected";
  approveTx?: string;
}

/**
 * Live offers on a campaign, each marked with the merchant's own decision. Arkiv is public, so this
 * needs no wallet. Decisions are read filtered to the merchant (`ownedBy`), so a stranger's "decision"
 * entity can never mark an offer as approved.
 */
export async function readOffers(campaignId: string, merchant: Address): Promise<OfferRow[]> {
  const arkiv = await loadArkiv();
  const reader = arkiv.createArkivReader();
  const id = BigInt(campaignId);
  const [offers, decisions] = await Promise.all([arkiv.listOffers(reader, id), arkiv.listDecisions(reader, id, merchant)]);
  const byOffer = new Map(decisions.map((d) => [String(d.offerKey).toLowerCase(), d]));
  return offers.map((o) => {
    const d = byOffer.get(String(o.entityKey).toLowerCase());
    return {
      entityKey: String(o.entityKey),
      creator: String(o.creator),
      channel: o.channel,
      audience: o.audience,
      askBps: o.askBps,
      expectedReach: String(o.expectedReach),
      ...(d && { decision: d.result as "approved" | "rejected", approveTx: d.approveTx || undefined }),
    };
  });
}
