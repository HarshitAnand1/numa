import { useState } from "react";
import { isUserRejection } from "@numa/sdk-react";
import { useAccount, useConnect, useSendTransaction, useSignMessage, useSwitchChain } from "wagmi";
import type { Address } from "viem";
import { useLive } from "../api/useLive";
import { bpsToPercent, shortAddress } from "../api/format";
import { CHAIN_ID } from "../web3/config";
import {
  PolicyApiError,
  agentsApi,
  readPolicy,
  savePolicy,
  type AgentBindingInfo,
  type DealTicket,
  type ThreadDetail,
  type ThreadSummary,
} from "./agentsApi";
import { ArkivWriteError, STEP_TEXT, type ArkivStep } from "../web3/arkivWallet";
import { bindAgent, revokeBinding } from "./binding";
import {
  defaultForm,
  formFromPolicy,
  readRequest,
  toBody,
  validateForm,
  writeRequest,
  type AgentRole,
  type FieldErrors,
  type PolicyForm,
} from "./policyForm";

const FAUCET = "https://hub.arkiv.network/faucet";

export function Agents() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const [role, setRole] = useState<AgentRole>("creator");
  const noWallet = typeof window !== "undefined" && !("ethereum" in window);
  const principal = isConnected ? (address as Address) : undefined;
  const status = useLive((s) => agentsApi.status(s), []);

  return (
    <main className="page ag-page">
      <div className="page-poster">
        <span className="poster-code">AGENTS / NEGOTIATION</span>
        <h1>
          LET IT HAGGLE.
          <br />
          <em>YOU SET THE FLOOR.</em>
        </h1>
        <p className="ag-lede">
          Switch on an agent and it negotiates the commission rate over Arkiv while you’re away, strictly inside limits only
          you know. It can’t go past them, and it can’t sign anything that moves money: a deal still ends in a normal
          on-chain approval you sign.
        </p>
      </div>

      {status.error && (
        <div className="ag-wrap">
          <div className="sim-banner" role="alert">
            <b>AGENTS UNAVAILABLE</b>
            <span>The API didn’t answer ({status.error}). Policy, binding and the feed need it.</span>
          </div>
        </div>
      )}
      {status.data && !status.data.enabled && (
        <div className="ag-wrap">
          <div className="sim-banner" role="status">
            <b>AGENTS ARE OFF</b>
            <span>This server has no agent wallet configured, so there is nothing to bind to yet.</span>
          </div>
        </div>
      )}

      <div className="ag-wrap">
        <div className="ag-roles" role="tablist" aria-label="Your role">
          {(["creator", "merchant"] as const).map((r) => (
            <button key={r} role="tab" aria-selected={role === r} className={role === r ? "on" : ""} onClick={() => setRole(r)}>
              I’m a {r}
            </button>
          ))}
        </div>

        {!principal ? (
          <section className="ag-card ag-gate">
            <h2>connect to continue.</h2>
            <p>The wallet you connect is who the agent speaks for. Your policy is private to it and every change is signed by it.</p>
            <button className="hard-button" disabled={isPending} onClick={() => !noWallet && connect({ connector: connectors[0], chainId: CHAIN_ID })}>
              {isPending ? "CONNECTING…" : noWallet ? "NO WALLET FOUND IN THIS BROWSER" : "CONNECT WALLET"}
            </button>
          </section>
        ) : (
          <>
            <BindingCard key={`b-${role}-${principal}`} principal={principal} role={role} agentAddress={status.data?.agentAddress ?? null} enabled={!!status.data?.enabled} />
            <PolicyCard key={`p-${role}-${principal}`} principal={principal} role={role} />
            <FeedCard key={`f-${role}-${principal}`} principal={principal} role={role} />
            {role === "merchant" && <DealsCard key={`d-${principal}`} principal={principal} />}
          </>
        )}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- binding */

function BindingCard({ principal, role, agentAddress, enabled }: { principal: Address; role: AgentRole; agentAddress: string | null; enabled: boolean }) {
  const binding = useLive((s) => agentsApi.binding(principal, role, s), [principal, role], { every: 15000 });
  const [busy, setBusy] = useState<ArkivStep | "waiting" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const info: AgentBindingInfo | undefined = binding.data;

  /** Arkiv indexes in under a second, but poll briefly so the card reflects the change without a reload. */
  const settle = async (want: boolean) => {
    setBusy("waiting");
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const fresh = await agentsApi.binding(principal, role).catch(() => undefined);
      if (fresh && fresh.bound === want) break;
    }
    binding.reload();
  };

  const run = async (kind: "bind" | "revoke", entityKey?: string) => {
    if (busy) return;
    setMsg(null);
    try {
      if (kind === "bind") {
        if (!agentAddress) return;
        await bindAgent({ address: principal, agent: agentAddress as Address, role, onStep: setBusy });
      } else {
        await revokeBinding({ address: principal, entityKey: entityKey as string, onStep: setBusy });
      }
      setMsg({ kind: "ok", text: kind === "bind" ? "Binding published. Your agent can now negotiate for you." : "Binding deleted. The agent can no longer speak for you." });
      await settle(kind === "bind");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ArkivWriteError ? e.message : "Something went wrong. Nothing was changed." });
    } finally {
      setBusy(null);
    }
  };

  const mine = (info?.bindings ?? []).filter((b) => !agentAddress || b.agent.toLowerCase() === agentAddress.toLowerCase());
  return (
    <section className="ag-card">
      <div className="ag-head">
        <div>
          <span className="ag-kicker">01 / BINDING · ARKIV</span>
          <h2>connect your agent.</h2>
        </div>
        <span className={`ag-pill ${info?.bound ? "ok" : ""}`}>{binding.loading && !info ? "CHECKING…" : info?.bound ? "● CONNECTED" : "○ NOT CONNECTED"}</span>
      </div>
      <p className="ag-note">
        The agent is a separate wallet that only holds Arkiv test gas. You authorize it by publishing a short-lived (30 day)
        binding from <b>your</b> wallet. Messages from anyone else, or from an unbound wallet, are ignored.
      </p>
      <dl className="ag-facts">
        <div>
          <dt>agent wallet</dt>
          <dd>{agentAddress ? <code>{agentAddress}</code> : "—"}</dd>
        </div>
        <div>
          <dt>you sign on</dt>
          <dd>Arkiv (Rabdi) · costs tGLM test gas</dd>
        </div>
      </dl>
      {!info?.bound && (
        <button className="hard-button" disabled={!enabled || !agentAddress || !!busy} onClick={() => run("bind")}>
          {busy ? STEP_TEXT[busy as ArkivStep] ?? "Waiting for Arkiv to index it…" : "BIND MY AGENT"}
        </button>
      )}
      {mine.map((b) => (
        <div className="ag-row" key={b.entityKey}>
          <span>
            <small>live binding</small>
            <code>{shortAddress(b.entityKey, 10, 6)}</code>
          </span>
          <button className="outline-button" disabled={!!busy} onClick={() => run("revoke", b.entityKey)}>
            {busy ? "WORKING…" : "REVOKE"}
          </button>
        </div>
      ))}
      <p className="ag-fine">
        Need test gas? <a href={FAUCET} target="_blank" rel="noopener noreferrer">Arkiv faucet ↗</a>. Your wallet will ask to add the Arkiv network the first time.
      </p>
      {msg && (
        <p className={`ag-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
      {binding.error && !info && <p className="ag-msg err">Couldn’t read binding status: {binding.error}</p>}
    </section>
  );
}

/* ----------------------------------------------------------------- policy */

function PolicyCard({ principal, role }: { principal: Address; role: AgentRole }) {
  const { signMessageAsync } = useSignMessage();
  const [form, setForm] = useState<PolicyForm>(() => defaultForm(role));
  const [busy, setBusy] = useState<"save" | "load" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const merchant = role === "merchant";
  const set = (k: keyof PolicyForm, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }) as PolicyForm);
  };

  const fail = (e: unknown) => {
    if (isUserRejection(e)) return setMsg({ kind: "info", text: "You declined to sign. Nothing was saved." });
    if (e instanceof PolicyApiError) {
      if (e.code === "UNAUTHORIZED") return setMsg({ kind: "err", text: "The API rejected the signature as not yours or too old. Check your computer’s clock (it allows 5 minutes) and try again." });
      if (e.code === "NOT_FOUND") return setMsg({ kind: "info", text: "No policy saved yet for this wallet and role. Fill the form and save." });
      if (e.code === "NETWORK") return setMsg({ kind: "err", text: "The API is unreachable. Nothing was saved." });
      return setMsg({ kind: "err", text: e.message });
    }
    setMsg({ kind: "err", text: "Something went wrong. Nothing was saved." });
  };

  const save = async () => {
    if (busy) return;
    setMsg(null);
    const body = toBody(principal, role, form);
    if ("errors" in body) return; // the button is disabled while invalid, and the errors are on screen
    setBusy("save");
    try {
      const { message, payload } = writeRequest(body, Math.floor(Date.now() / 1000));
      const signature = await signMessageAsync({ message });
      const res = await savePolicy(payload, signature);
      setMsg({ kind: "ok", text: res.enabled ? "Saved. Your agent will negotiate inside these limits." : "Saved, but the agent is switched off. It won’t negotiate." });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const load = async () => {
    if (busy) return;
    setMsg(null);
    setBusy("load");
    try {
      const { message, payload } = readRequest(principal, role, Math.floor(Date.now() / 1000));
      const signature = await signMessageAsync({ message });
      const p = await readPolicy(payload, signature);
      setForm(formFromPolicy(p));
      setMsg({ kind: "ok", text: "Loaded your saved policy." });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const live = validateForm(role, form);
  // errors are live: the save button is disabled while the form is invalid, so they must be visible
  const errors: FieldErrors = live.ok ? {} : live.errors;
  const field = (k: keyof PolicyForm, label: string, hint: string, suffix = "%") => (
    <label className={`ag-field ${errors[k] ? "bad" : ""}`} key={k}>
      <span>{label}</span>
      <div>
        <input inputMode="decimal" value={form[k] as string} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} />
        <i>{suffix}</i>
      </div>
      <small>{errors[k] ?? hint}</small>
    </label>
  );

  return (
    <section className="ag-card">
      <div className="ag-head">
        <div>
          <span className="ag-kicker">02 / POLICY · PRIVATE</span>
          <h2>{merchant ? "how high will you go?" : "how low will you go?"}</h2>
        </div>
        <label className="ag-toggle">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <span>agent {form.enabled ? "on" : "off"}</span>
        </label>
      </div>
      <p className="ag-note">
        Your limits are never published to Arkiv and the other side never sees them. Saving and reading them each need a
        wallet signature (no gas, not a transaction), valid for 5 minutes. Nothing is kept in this browser.
      </p>
      <div className="ag-grid">
        {field("limit", merchant ? "ceiling" : "floor", merchant ? "never pay more than this" : "never accept less than this")}
        {merchant && field("opening", "opening offer", "your first proposal, at or below the ceiling")}
        {field("autoAccept", "auto-accept", merchant ? "accept an ask at or below this at once" : "accept an offer at or above this at once")}
        {field("step", "step", "how far each counter moves (0.1% to 10%)")}
        {field("maxRounds", "max rounds", "1 to 10, then it stops", "")}
        {merchant && (
          <label className={`ag-field wide ${errors.categories ? "bad" : ""}`}>
            <span>only these categories</span>
            <div>
              <input value={form.categories} onChange={(e) => set("categories", e.target.value)} placeholder="streetwear, music (empty = all)" />
            </div>
            <small>{errors.categories ?? "campaign categories this agent may negotiate for"}</small>
          </label>
        )}
      </div>
      <div className="ag-actions">
        <button className="hard-button" disabled={!!busy || !live.ok} onClick={save}>
          {busy === "save" ? "SIGN IN YOUR WALLET…" : "SIGN + SAVE POLICY"}
        </button>
        <button className="outline-button" disabled={!!busy} onClick={load}>
          {busy === "load" ? "SIGN IN YOUR WALLET…" : "LOAD MY SAVED POLICY"}
        </button>
      </div>
      {!live.ok && <p className="ag-fine">Fix the highlighted fields to enable saving.</p>}
      {msg && (
        <p className={`ag-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- feed */

const VERB = { propose: "proposed", counter: "countered at", accept: "accepted", reject: "rejected" } as const;

function FeedCard({ principal, role }: { principal: Address; role: AgentRole }) {
  const feed = useLive((s) => agentsApi.threads(principal, role, s), [principal, role], { every: 15000 });
  const [open, setOpen] = useState<string | null>(null);
  const threads: ThreadSummary[] = feed.data ?? [];
  return (
    <section className="ag-card">
      <div className="ag-head">
        <div>
          <span className="ag-kicker">03 / ACTIVITY · LIVE</span>
          <h2>what your agent is doing.</h2>
        </div>
        <span className="ag-pill">{feed.loading && !feed.data ? "LOADING…" : `${threads.length} THREAD${threads.length === 1 ? "" : "S"}`}</span>
      </div>
      <p className="ag-note">Every live offer you’re part of, with its verified negotiation. It refreshes by itself every 15 seconds. Messages that fail verification are dropped and counted, never shown as real.</p>
      {feed.error && !feed.data && <p className="ag-msg err">Couldn’t load activity: {feed.error}</p>}
      {feed.data && !threads.length && (
        <div className="empty small">
          <h3>nothing negotiating yet.</h3>
          <p>{role === "creator" ? "Publish an offer on a campaign and your agent will start talking to the merchant’s." : "When a creator offers on one of your campaigns, your agent answers here."}</p>
        </div>
      )}
      {threads.map((t) => (
        <div className="ag-thread" key={t.offerKey}>
          <button className="ag-thread-head" aria-expanded={open === t.offerKey} onClick={() => setOpen(open === t.offerKey ? null : t.offerKey)}>
            <span>
              <b>{t.campaignName || `Campaign #${t.campaignId}`}</b>
              <small>
                {role === "creator" ? `merchant ${shortAddress(t.merchant)}` : `creator ${shortAddress(t.creator)}`} · asked {bpsToPercent(t.offerAskBps)} · round {t.round}
              </small>
            </span>
            <span className="ag-last">
              {t.last ? `${t.last.from} ${VERB[t.last.action]}${t.last.action === "accept" || t.last.action === "reject" ? "" : ` ${bpsToPercent(t.last.bps)}`}` : "no messages yet"}
            </span>
            <span className={`ag-state ${t.state}`}>{t.state === "deal" ? `DEAL ${t.agreedBps !== undefined ? bpsToPercent(t.agreedBps) : ""}` : t.state.toUpperCase()}</span>
          </button>
          {open === t.offerKey && <ThreadBody offerKey={t.offerKey} ignored={t.ignoredMessages} />}
        </div>
      ))}
    </section>
  );
}

function ThreadBody({ offerKey, ignored }: { offerKey: string; ignored: number }) {
  const t = useLive<ThreadDetail>((s) => agentsApi.thread(offerKey, s), [offerKey], { every: 15000 });
  if (t.loading && !t.data) return <p className="ag-fine">Loading the thread…</p>;
  if (t.error && !t.data) return <p className="ag-msg err">Couldn’t load this thread: {t.error}</p>;
  const msgs = (t.data?.messages ?? []).filter((m) => m.verifiedOwner);
  return (
    <ol className="ag-timeline">
      <li>
        <b>offer</b> creator asked {bpsToPercent(t.data?.offerAskBps ?? 0)}
      </li>
      {msgs.map((m) => (
        <li key={m.entityKey} className={m.action}>
          <b>
            {m.from} {VERB[m.action]}
            {m.action === "accept" || m.action === "reject" ? "" : ` ${bpsToPercent(m.bps)}`}
          </b>
          {/* counterparty-written text: shown as plain text only */}
          {m.note && <span>{m.note.slice(0, 400)}</span>}
        </li>
      ))}
      {ignored > 0 && (
        <li className="ignored">
          <b>{ignored} message{ignored === 1 ? "" : "s"} ignored</b>
          <span>They weren’t written by a party to this offer or its bound agent.</span>
        </li>
      )}
    </ol>
  );
}

/* ------------------------------------------------------------------ deals */

function DealsCard({ principal }: { principal: Address }) {
  const deals = useLive((s) => agentsApi.deals(principal, s), [principal], { every: 15000 });
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [sent, setSent] = useState<Record<string, { hash?: string; error?: string }>>({});
  const tickets: DealTicket[] = deals.data ?? [];

  const send = async (key: string, to: string, data: string) => {
    setSent((s) => ({ ...s, [key]: {} }));
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
      const hash = await sendTransactionAsync({ to: to as Address, data: data as `0x${string}` });
      setSent((s) => ({ ...s, [key]: { hash } }));
    } catch (e) {
      setSent((s) => ({ ...s, [key]: { error: isUserRejection(e) ? "You declined. Nothing was sent." : "The transaction failed. Nothing was approved." } }));
    }
  };

  return (
    <section className="ag-card">
      <div className="ag-head">
        <div>
          <span className="ag-kicker">04 / DEALS · YOU SIGN</span>
          <h2>deals waiting for you.</h2>
        </div>
        <span className="ag-pill">{tickets.length}</span>
      </div>
      <p className="ag-note">
        When both agents agree, the deal still needs <b>your</b> on-chain approval. The agent can’t do this step. Each step below
        is a real Whitechain transaction from your wallet.
      </p>
      {deals.error && !deals.data && <p className="ag-msg err">Couldn’t load deals: {deals.error}</p>}
      {deals.data && !tickets.length && (
        <div className="empty small">
          <h3>no deals yet.</h3>
          <p>Agreed deals show up here with the exact steps to approve the creator.</p>
        </div>
      )}
      {tickets.map((d) => (
        <article className="ag-deal" key={d.offerKey}>
          <h3>
            Campaign #{d.campaignId} · creator {shortAddress(d.creator)} · agreed {bpsToPercent(d.agreedBps)}
          </h3>
          <ol>
            {d.steps.map((s, i) => {
              const key = `${d.offerKey}-${i}`;
              const st = sent[key];
              return (
                <li key={key}>
                  <span>{s.description}</span>
                  {s.data ? (
                    st?.hash ? (
                      <small className="ok">sent · {shortAddress(st.hash, 8, 6)}</small>
                    ) : (
                      <button className="outline-button" onClick={() => send(key, s.to, s.data as string)} disabled={st !== undefined && !st.error}>
                        {st && !st.error ? "CONFIRM IN WALLET…" : "SIGN + SEND"}
                      </button>
                    )
                  ) : (
                    <small>do this after the step above (needs the new campaign id)</small>
                  )}
                  {st?.error && <small className="err">{st.error}</small>}
                </li>
              );
            })}
          </ol>
        </article>
      ))}
      <p className="ag-fine">Not yet tried against a deployed registry.</p>
    </section>
  );
}
