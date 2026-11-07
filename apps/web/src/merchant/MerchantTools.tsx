import { useState } from "react";
import type { Address } from "viem";
import { api } from "../api/client";
import { bpsToPercent, shortAddress, txUrl } from "../api/format";
import { useLive } from "../api/useLive";
import type { ApiCampaign } from "../api/types";
import { ArkivWriteError, STEP_TEXT, type ArkivStep } from "../web3/arkivWallet";
import { publishCampaignListing, publishMyDecision, readOffers, type OfferRow } from "../web3/arkivActions";
import { ChainActionError, approveCreatorTx, createCampaignTx } from "../web3/chainActions";
import { emptyCampaign, validateCampaign, type CampaignForm, type CampaignValue } from "../web3/entityForms";

type Msg = { kind: "ok" | "err" | "info"; text: string } | null;
const errText = (e: unknown) => (e instanceof ArkivWriteError || e instanceof ChainActionError ? e.message : "Something went wrong. Nothing changed.");
const FAUCET = "https://hub.arkiv.network/faucet";

function Notice({ msg }: { msg: Msg }) {
  return msg ? (
    <p className={`ag-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>
      {msg.text}
    </p>
  ) : null;
}

/** The merchant's own campaigns, from the public campaign list (owner = the connected wallet). */
function useMyCampaigns(address: Address) {
  const all = useLive<ApiCampaign[]>((s) => api.campaigns({ limit: 100 }, s), [address]);
  const mine = (all.data ?? []).filter((c) => c.merchant.toLowerCase() === address.toLowerCase());
  return { mine, loading: all.loading, error: all.error, reload: all.reload };
}

const NO_CONTRACTS = (
  <div className="sim-banner" role="status">
    <b>CONTRACTS NOT DEPLOYED</b>
    <span>Creating a campaign and approving creators are on-chain transactions on the CampaignRegistry, which isn’t deployed yet. Nothing here can run until it is.</span>
  </div>
);

/* ------------------------------------------------------------ new campaign */

export function MerchantCampaigns({ address, registry }: { address: Address; registry: Address | undefined }) {
  const [form, setForm] = useState<CampaignForm>(() => emptyCampaign(address));
  const [phase, setPhase] = useState<"idle" | "chain" | "listing">("idle");
  const [step, setStep] = useState<ArkivStep | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  // the campaign exists on-chain but its Arkiv listing isn't published yet: never lose that fact
  const [pending, setPending] = useState<{ campaignId: bigint; txHash: string; value: CampaignValue } | null>(null);
  const mine = useMyCampaigns(address);
  const busy = phase !== "idle";
  const v = validateCampaign(form);
  const errors = v.ok ? {} : v.errors;
  const set = (k: keyof CampaignForm, val: string) => setForm((f) => ({ ...f, [k]: val }));

  const listing = async (p: NonNullable<typeof pending>) => {
    setPhase("listing");
    try {
      await publishCampaignListing({ address, campaignId: p.campaignId, listing: p.value.listing, commissionBps: p.value.commissionBps, endsAt: p.value.endsAt, onStep: setStep });
      setPending(null);
      setMsg({ kind: "ok", text: `Campaign #${p.campaignId} is live: created on-chain and listed on Arkiv, so creators can find it.` });
      setForm(emptyCampaign(address));
      setTimeout(mine.reload, 3000);
    } catch (e) {
      setPending(p);
      setMsg({ kind: "err", text: `Campaign #${p.campaignId} exists on-chain (tx ${shortAddress(p.txHash, 8, 6)}), but publishing its Arkiv listing failed: ${errText(e)} Creators can’t find it until it’s listed. Retry below.` });
    } finally {
      setPhase("idle");
      setStep(null);
    }
  };

  const create = async () => {
    if (!v.ok || busy || !registry) return;
    setMsg(null);
    setPhase("chain");
    let made;
    try {
      made = await createCampaignTx({ registry, account: address, payoutSigner: v.value.payoutSigner, commissionBps: v.value.commissionBps, endsAt: v.value.endsAt });
    } catch (e) {
      setPhase("idle");
      return setMsg({ kind: "err", text: errText(e) });
    }
    await listing({ campaignId: made.campaignId, txHash: made.txHash, value: v.value });
  };

  const field = (k: keyof CampaignForm, label: string, hint: string, o: { area?: boolean; suffix?: string; placeholder?: string } = {}) => (
    <label className={`ag-field light ${errors[k] ? "bad" : ""} ${o.area ? "wide" : ""}`} key={k}>
      <span>{label}</span>
      <div>
        {o.area ? <textarea rows={3} value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={o.placeholder} /> : <input value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={o.placeholder} />}
        {o.suffix && <i>{o.suffix}</i>}
      </div>
      <small>{errors[k] ?? hint}</small>
    </label>
  );

  return (
    <section className="app-panel merchant-tools">
      <div className="panel-title">
        <div>
          <span>NEW CAMPAIGN</span>
          <h2>
            pay only when
            <br />
            money moves.
          </h2>
        </div>
      </div>
      {!registry && NO_CONTRACTS}
      <p className="panel-note">Two things happen: a Whitechain transaction records the terms (you pay a little WBT), then an Arkiv transaction lists the campaign so creators can discover it (a little tGLM). Terms can’t be edited later: a new rate means a new campaign.</p>
      <div className="ag-grid light">
        {field("name", "campaign name", "what creators see")}
        {field("category", "category", "like streetwear or music")}
        {field("commission", "creator commission", "paid only on a settled sale; max 50%", { suffix: "%" })}
        {field("days", "runs for", "days from now, up to 175", { suffix: "days" })}
        {field("region", "region", "like global, us, eu")}
        {field("payoutSigner", "order-signing address", "the key your order server signs with; your own wallet works for a demo")}
        {field("description", "brief", "optional, up to 280 characters", { area: true })}
      </div>
      <div className="ag-actions">
        <button className="hard-button" disabled={busy || !v.ok || !registry} onClick={create}>
          {phase === "chain" ? "CONFIRM THE CAMPAIGN IN YOUR WALLET…" : phase === "listing" ? (step ? STEP_TEXT[step] : "PUBLISHING THE LISTING…") : "CREATE CAMPAIGN"}
        </button>
        {pending && (
          <button className="outline-button" disabled={busy} onClick={() => listing(pending)}>
            RETRY THE ARKIV LISTING
          </button>
        )}
      </div>
      <p className="panel-note"><a href={FAUCET} target="_blank" rel="noopener noreferrer">Need tGLM for the listing? Faucet ↗</a></p>
      <Notice msg={msg} />
      <h3 className="list-title">your campaigns</h3>
      {mine.mine.map((c) => (
        <div className="mini-row" key={c.campaignId}>
          <span>
            <b>{c.name || `Campaign #${c.campaignId}`}</b>
            <small>#{c.campaignId} · {bpsToPercent(c.commissionBps)} · {c.category} · ends {new Date(c.endsAt * 1000).toLocaleDateString("en-GB")}</small>
          </span>
          <span className="status live">{c.status.toUpperCase()}</span>
        </div>
      ))}
      {!mine.loading && !mine.mine.length && <p className="panel-note">{mine.error ? `Couldn’t load your campaigns: ${mine.error}` : "No listed campaigns for this wallet yet."}</p>}
    </section>
  );
}

/* ----------------------------------------------------------------- offers */

type RowState = { busy?: string; msg?: Msg; pendingTx?: string };

export function MerchantOffers({ address, registry }: { address: Address; registry: Address | undefined }) {
  const mine = useMyCampaigns(address);
  const [picked, setPicked] = useState("");
  const campaign = mine.mine.find((c) => c.campaignId === (picked || mine.mine[0]?.campaignId));
  const id = campaign?.campaignId ?? "";
  const offers = useLive<OfferRow[]>(() => readOffers(id, address), [id, address], { every: 20000, enabled: !!id });
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const patch = (k: string, s: RowState) => setRows((r) => ({ ...r, [k]: { ...r[k], ...s } }));
  const anyBusy = Object.values(rows).some((r) => r.busy);

  const decide = async (o: OfferRow, result: "approved" | "rejected", txHash?: string) => {
    if (!campaign) return;
    try {
      patch(o.entityKey, { busy: "Publishing your decision on Arkiv…", msg: null });
      await publishMyDecision({ address, offerKey: o.entityKey, campaignId: BigInt(campaign.campaignId), result, approveTx: txHash, campaignEndsAt: campaign.endsAt, onStep: (s) => patch(o.entityKey, { busy: STEP_TEXT[s] }) });
      patch(o.entityKey, { busy: undefined, pendingTx: undefined, msg: { kind: "ok", text: result === "approved" ? "Approved on-chain and published." : "Rejected and published." } });
      setTimeout(offers.reload, 3000);
    } catch (e) {
      patch(o.entityKey, {
        busy: undefined,
        pendingTx: txHash,
        msg: { kind: "err", text: txHash ? `The creator IS approved on-chain (tx ${shortAddress(txHash, 8, 6)}), but publishing your decision to Arkiv failed: ${errText(e)} Retry below so the creator can see it.` : errText(e) },
      });
    }
  };

  const approve = async (o: OfferRow) => {
    if (!campaign || !registry || anyBusy) return;
    patch(o.entityKey, { busy: "Confirm the approval in your wallet…", msg: null });
    let tx;
    try {
      tx = await approveCreatorTx({ registry, account: address, campaignId: BigInt(campaign.campaignId), creator: o.creator as Address });
    } catch (e) {
      return patch(o.entityKey, { busy: undefined, msg: { kind: "err", text: errText(e) } });
    }
    await decide(o, "approved", tx.txHash);
  };

  return (
    <section className="app-panel merchant-tools">
      <div className="panel-title">
        <div>
          <span>OFFERS / ARKIV</span>
          <h2>
            they asked.
            <br />
            you decide.
          </h2>
        </div>
      </div>
      {!registry && NO_CONTRACTS}
      {mine.mine.length === 0 ? (
        <div className="empty small">
          <h3>no campaigns yet.</h3>
          <p>Offers arrive on a campaign you’ve listed. Create one first.</p>
        </div>
      ) : (
        <>
          <label className="ag-field light">
            <span>campaign</span>
            <div>
              <select value={id} onChange={(e) => setPicked(e.target.value)}>
                {mine.mine.map((c) => (
                  <option key={c.campaignId} value={c.campaignId}>
                    {c.name || `Campaign #${c.campaignId}`} · up to {bpsToPercent(c.commissionBps)}
                  </option>
                ))}
              </select>
            </div>
            <small>read from Arkiv, refreshed every 20 seconds</small>
          </label>
          <p className="panel-note">Approving is a Whitechain transaction (<code>approveCreator</code>) signed by you, followed by an Arkiv entity recording your decision. Only the on-chain approval lets a sale settle through the creator.</p>
          {offers.error && !offers.data && <p className="ag-msg err">Couldn’t read offers from Arkiv: {offers.error}</p>}
          {(offers.data ?? []).map((o) => {
            const st = rows[o.entityKey] ?? {};
            const tooHigh = campaign ? o.askBps > campaign.commissionBps : false;
            return (
              <article className="offer-card" key={o.entityKey}>
                <div>
                  <h3>creator {shortAddress(o.creator)}</h3>
                  <p>{o.channel.replace(/-/g, " ")} · asks {bpsToPercent(o.askBps)} · reach {Number(o.expectedReach).toLocaleString("en-US")}</p>
                  {/* creator-written text: shown as plain text only */}
                  <p className="offer-aud">{o.audience}</p>
                  {tooHigh && <small className="err">asks more than this campaign pays ({bpsToPercent(campaign!.commissionBps)}); the contract pays the campaign’s rate, not the ask</small>}
                </div>
                <div className="offer-actions">
                  {o.decision ? (
                    <span className={`status ${o.decision === "approved" ? "live" : "ended"}`}>{o.decision.toUpperCase()}</span>
                  ) : st.pendingTx ? (
                    <button className="hard-button" disabled={!!st.busy} onClick={() => decide(o, "approved", st.pendingTx)}>
                      RETRY PUBLISHING DECISION
                    </button>
                  ) : (
                    <>
                      <button className="outline-button" disabled={!!st.busy || anyBusy} onClick={() => decide(o, "rejected")}>
                        REJECT
                      </button>
                      <button className="hard-button" disabled={!!st.busy || anyBusy || !registry} onClick={() => approve(o)}>
                        APPROVE (WALLET)
                      </button>
                    </>
                  )}
                  {o.approveTx && (
                    <a href={txUrl(o.approveTx)} target="_blank" rel="noopener noreferrer">
                      approval tx ↗
                    </a>
                  )}
                </div>
                {st.busy && <p className="ag-msg info">{st.busy}</p>}
                <Notice msg={st.msg ?? null} />
              </article>
            );
          })}
          {offers.data && !offers.data.length && (
            <div className="empty small">
              <h3>no live offers.</h3>
              <p>Creators’ offers last 72 hours. They’ll show up here as they’re published.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
