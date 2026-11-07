import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { api } from "../api/client";
import { bpsToPercent, formatUsdt } from "../api/format";
import { useLive } from "../api/useLive";
import type { ApiCampaign, ApiLinkStats, ApiProfile } from "../api/types";
import { API_BASE } from "../api/client";
import { STEP_TEXT, ArkivWriteError, type ArkivStep } from "../web3/arkivWallet";
import { publishMyLink, publishMyProfile, renewMyProfile, updateMyProfile } from "../web3/arkivActions";
import {
  DAY,
  emptyProfile,
  makeLinkStore,
  suggestLinkCode,
  trackerUrl,
  validateLink,
  validateProfile,
  type ProfileForm,
  type SavedLink,
} from "../web3/entityForms";
import { MAX_BPS, bpsToPct, pctToBps } from "../agents/policyForm";

type Msg = { kind: "ok" | "err"; text: string } | null;
const FAUCET = "https://hub.arkiv.network/faucet";
const errText = (e: unknown) => (e instanceof ArkivWriteError ? e.message : "Something went wrong. Nothing was published.");

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`ag-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>
      {msg.text}
    </p>
  );
}

/* ---------------------------------------------------------------- profile */

/**
 * Create the creator's public profile, or (once it exists) change availability and minimum ask and
 * renew it. Name, bio and niche are fixed after publishing: only those fields can be patched on Arkiv
 * without creating a second, conflicting profile entity.
 */
export function ProfileEditor({ address, profile, onChanged }: { address: Address; profile: ApiProfile | null; onChanged: () => void }) {
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [open, setOpen] = useState(profile?.open ?? true);
  const [minAsk, setMinAsk] = useState(profile ? bpsToPct(profile.minAskBps) : "10");
  const [step, setStep] = useState<ArkivStep | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const busy = step !== null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: done });
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setStep(null);
    }
  };

  if (profile) {
    const bps = pctToBps(minAsk);
    const minAskOk = bps !== null && bps <= MAX_BPS;
    return (
      <>
        <div className="panel-title">
          <div>
            <span>PROFILE / WALLET-OWNED</span>
            <h2>
              this is you,
              <br />
              on arkiv.
            </h2>
          </div>
          <span className="status live">● PUBLISHED</span>
        </div>
        <dl className="ag-facts light">
          <div><dt>name</dt><dd>{profile.displayName}</dd></div>
          <div><dt>niche / channel</dt><dd>{profile.niche} / {profile.channel}</dd></div>
          <div><dt>bio</dt><dd>{profile.bio || "—"}</dd></div>
        </dl>
        <p className="panel-note">Name, bio and niche can’t be edited yet. Availability and your minimum ask can, and you can keep the profile alive (it expires after 90 days).</p>
        <div className="ag-grid light">
          <label className={`ag-field ${minAskOk ? "" : "bad"}`}>
            <span>minimum ask</span>
            <div>
              <input inputMode="decimal" value={minAsk} onChange={(e) => setMinAsk(e.target.value)} />
              <i>%</i>
            </div>
            <small>{minAskOk ? "merchants below this won’t be matched to you" : "A percent from 0 to 50."}</small>
          </label>
          <label className="ag-toggle light">
            <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
            <span>open for work</span>
          </label>
        </div>
        <div className="ag-actions">
          <button
            className="hard-button"
            disabled={busy || !minAskOk}
            onClick={() => run(() => updateMyProfile({ address, entityKey: profile.entityKey, open, minAskBps: bps as number, onStep: setStep }), "Saved. Your profile is updated.")}
          >
            {busy ? STEP_TEXT[step as ArkivStep] : "SAVE (ARKIV TX)"}
          </button>
          <button className="outline-button" disabled={busy} onClick={() => run(() => renewMyProfile({ address, entityKey: profile.entityKey, onStep: setStep }), "Renewed for another 90 days.")}>
            RENEW 90 DAYS
          </button>
        </div>
        <p className="panel-note">Each save is a transaction signed by your wallet on Arkiv and costs a little tGLM. <a href={FAUCET} target="_blank" rel="noopener noreferrer">Faucet ↗</a></p>
        <Notice msg={msg} />
      </>
    );
  }

  const v = validateProfile(form);
  const errors = v.ok ? {} : v.errors;
  const set = (k: keyof ProfileForm, val: string | boolean) => setForm((f) => ({ ...f, [k]: val }) as ProfileForm);
  const field = (k: keyof ProfileForm, label: string, hint: string, opts: { area?: boolean; suffix?: string; placeholder?: string } = {}) => (
    <label className={`ag-field light ${errors[k] ? "bad" : ""} ${opts.area ? "wide" : ""}`} key={k}>
      <span>{label}</span>
      <div>
        {opts.area ? (
          <textarea value={form[k] as string} onChange={(e) => set(k, e.target.value)} placeholder={opts.placeholder} rows={3} />
        ) : (
          <input value={form[k] as string} onChange={(e) => set(k, e.target.value)} placeholder={opts.placeholder} />
        )}
        {opts.suffix && <i>{opts.suffix}</i>}
      </div>
      <small>{errors[k] ?? hint}</small>
    </label>
  );
  return (
    <>
      <div className="panel-title">
        <div>
          <span>PROFILE / WALLET-OWNED</span>
          <h2>
            say enough.
            <br />
            not everything.
          </h2>
        </div>
        <span className="status paused">○ NOT PUBLISHED</span>
      </div>
      <p className="panel-note">Merchants search creators by niche, channel and minimum ask. Publishing is a transaction signed by your wallet on Arkiv (costs a little tGLM) and you own it.</p>
      <div className="ag-grid light">
        {field("displayName", "display name", "how merchants see you")}
        {field("handle", "handle or link", "optional, where your audience is")}
        {field("niche", "main niche", "like streetwear, music, fitness")}
        {field("channel", "main channel", "like youtube, newsletter, podcast")}
        {field("niches", "other niches", "optional, comma-separated")}
        {field("minAsk", "minimum ask", "the lowest commission you’ll consider", { suffix: "%" })}
        {field("bio", "bio", "optional, up to 500 characters", { area: true })}
        <label className="ag-toggle light">
          <input type="checkbox" checked={form.open} onChange={(e) => set("open", e.target.checked)} />
          <span>open for work</span>
        </label>
      </div>
      <div className="ag-actions">
        <button className="hard-button" disabled={busy || !v.ok} onClick={() => v.ok && run(() => publishMyProfile({ address, profile: v.value, onStep: setStep }), "Published. It can take a few seconds to appear in search.")}>
          {busy ? STEP_TEXT[step as ArkivStep] : "PUBLISH TO ARKIV"}
        </button>
      </div>
      <p className="panel-note"><a href={FAUCET} target="_blank" rel="noopener noreferrer">Need tGLM? Faucet ↗</a></p>
      <Notice msg={msg} />
    </>
  );
}

/* ------------------------------------------------------------------ links */

const store = makeLinkStore(typeof window !== "undefined" ? safeStorage() : undefined);
function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
const daysLeft = (c: ApiCampaign | undefined) => (c ? Math.max(0, Math.floor((c.endsAt - Date.now() / 1000) / DAY)) : 0);

function LinkRow({ link, address }: { link: SavedLink; address: Address }) {
  const s = useLive<ApiLinkStats>((sig) => api.linkStats(link.code, address, link.campaignId, sig), [link.code, address], { every: 15000 });
  const url = trackerUrl(link.code, window.location.origin, API_BASE);
  const [copied, setCopied] = useState(false);
  return (
    <div className="data-list-row">
      <span>
        <code>{link.code}</code>
        <small>campaign #{link.campaignId}</small>
      </span>
      <span>
        {s.data ? s.data.clicks.toLocaleString("en-US") : "—"}
        <small>clicks · {s.data ? s.data.uniqueVisitors.toLocaleString("en-US") : "—"} unique · earn $0</small>
      </span>
      <span>
        {s.data?.settled ? s.data.settled.verifiedConversions : "—"}
        <small>{s.data?.settled ? "chain-verified sales" : (s.data?.note ?? s.error ?? "loading…")}</small>
      </span>
      <strong>{s.data?.settled ? `${formatUsdt(s.data.settled.commissionEarned)} USDT` : "—"}</strong>
      <button
        aria-label="Copy link"
        onClick={() => {
          navigator.clipboard?.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? "✓" : "copy"}
      </button>
    </div>
  );
}

/** Create attribution links (an Arkiv entity you own) and watch real click vs verified-sale numbers. */
export function LinksPanel({ address, campaigns }: { address: Address; campaigns: ApiCampaign[] }) {
  const [campaignId, setCampaignId] = useState("");
  const [code, setCode] = useState(() => suggestLinkCode());
  const [days, setDays] = useState("7");
  const [step, setStep] = useState<ArkivStep | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [links, setLinks] = useState<SavedLink[]>(() => store.list(address));
  const campaign = campaigns.find((c) => c.campaignId === (campaignId || campaigns[0]?.campaignId));
  const effectiveId = campaign?.campaignId ?? "";
  useEffect(() => setLinks(store.list(address)), [address]);
  const v = useMemo(() => validateLink({ code, days }, daysLeft(campaign)), [code, days, campaign]);
  const errors = v.ok ? {} : v.errors;
  const busy = step !== null;

  const create = async () => {
    if (!v.ok || busy || !effectiveId) return;
    setMsg(null);
    try {
      await publishMyLink({ address, campaignId: effectiveId, link: v.value, onStep: setStep });
      setLinks(store.add(address, { code: v.value.code, campaignId: effectiveId, days: v.value.days, createdAt: Math.floor(Date.now() / 1000) }));
      setMsg({ kind: "ok", text: `Link ${v.value.code} published. Share ${trackerUrl(v.value.code, window.location.origin, API_BASE)}` });
      setCode(suggestLinkCode());
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setStep(null);
    }
  };

  return (
    <>
      <div className="panel-title">
        <div>
          <span>ATTRIBUTION</span>
          <h2>
            links that know
            <br />
            when money moved.
          </h2>
        </div>
      </div>
      <p className="panel-note">Clicks are shown so you can see they’re worth nothing: only a settled USDT sale earns commission, and “settled” counts only sales verified on-chain. A link is an Arkiv entity owned by your wallet.</p>
      {campaigns.length === 0 ? (
        <div className="empty small">
          <h3>no active campaigns.</h3>
          <p>A link points at a campaign. When a merchant publishes one, you can create a link for it here.</p>
        </div>
      ) : (
        <div className="link-builder">
          <label className="ag-field light">
            <span>campaign</span>
            <div>
              <select value={effectiveId} onChange={(e) => setCampaignId(e.target.value)}>
                {campaigns.map((c) => (
                  <option key={c.campaignId} value={c.campaignId}>
                    {c.name || `Campaign #${c.campaignId}`} · up to {bpsToPercent(c.commissionBps)}
                  </option>
                ))}
              </select>
            </div>
            <small>ends in {daysLeft(campaign)} days</small>
          </label>
          <label className={`ag-field light ${errors.code ? "bad" : ""}`}>
            <span>code</span>
            <div>
              <input value={code} onChange={(e) => setCode(e.target.value.trim())} spellCheck={false} />
              <i role="button" tabIndex={0} onClick={() => setCode(suggestLinkCode())} title="New code">↻</i>
            </div>
            <small>{errors.code ?? "letters, numbers, dashes and underscores"}</small>
          </label>
          <label className={`ag-field light ${errors.days ? "bad" : ""}`}>
            <span>lasts</span>
            <div>
              <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
              <i>days</i>
            </div>
            <small>{errors.days ?? "how long the link stays live on Arkiv"}</small>
          </label>
          <button className="hard-button" disabled={busy || !v.ok} onClick={create}>
            {busy ? STEP_TEXT[step as ArkivStep] : "CREATE ON ARKIV"}
          </button>
        </div>
      )}
      <Notice msg={msg} />
      <p className="panel-note">Creating a link is an Arkiv transaction signed by your wallet (a little tGLM). <a href={FAUCET} target="_blank" rel="noopener noreferrer">Faucet ↗</a> Your list is kept in this browser; the links themselves live on Arkiv.</p>
      {links.length > 0 && (
        <>
          <div className="data-list-head">
            <span>CODE / CAMPAIGN</span>
            <span>CLICKS</span>
            <span>SETTLED</span>
            <span>EARNED</span>
            <span />
          </div>
          {links.map((l) => (
            <LinkRow key={l.code} link={l} address={address} />
          ))}
        </>
      )}
    </>
  );
}
