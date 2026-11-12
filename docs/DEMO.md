# Demo plan (3:30, one take) — **a plan; nothing here has been demonstrated yet**

Real transactions only. The submission needs a video of at most 4 minutes, **not sped up**. The refund window is 60 s on the deployed router and is disclosed on screen. The buyer wallet holds zero WBT. Pitches for the two tracks and the slide outline are in [`PITCH.md`](PITCH.md).

## Timeline

| Time | Beat | On screen |
|---|---|---|
| 0:00–0:20 | **Hook.** Brands pay for clicks, bots fake clicks, so merchants pay for traffic that never buys. "What if a creator got paid only when money moved? This is numa." | Title card or face |
| 0:20–0:50 | **Creator.** Profile and offer, approved by the merchant, copy the attribution link. Reputation counts only sales that match an on-chain event | Creator dashboard |
| 0:50–1:20 | **Merchant.** Campaign with a 10% commission locked on-chain. Approving a creator only whitelists; no escrow, funds never sit with us | Merchant dashboard |
| 1:20–2:15 | **Buyer (the money shot).** Open the creator link in the shop. Show the buyer wallet with zero WBT, press Pay, sign once. Open the settled transaction on the explorer and point at the three transfers: merchant net, held commission, protocol fee | Demo shop, wallet, explorer |
| 2:15–2:50 | **Refund window.** The creator's commission is held by the contract. A refund inside the window claws it back; otherwise the keeper releases it on chain time (`CommissionReleased`). Use the wait to explain it | Explorer or merchant dashboard |
| 2:50–3:15 | **Receipt and proof.** Public receipt, the accountant CSV, and the creator's reputation counting this sale because it matches `OrderSettled` | Receipt page, CSV |
| 3:15–3:30 | **Close.** "Proof of conversion isn't a dashboard, a pixel or a promise. It's a settled payment. That's numa." | Logo, two seconds of silence |

*Optional beats, only if rehearsed:* the 500-fake-clicks run (`pnpm --filter @numa/api demo:fake-clicks -- --code <link code> --n 500 --creator <addr> --campaign <id>`, then `/links/:code/stats` shows 500 clicks next to 0 verified sales); a partial refund with clawback (`OrderRefunded`); negotiation agents settling the rate over Arkiv (`AGENTS.md`). Cut the refund beat if the refund path isn't proven on the deployed router. Cut the agents unless `AGENT_WALLET_PRIVATE_KEY` is set on the hosted API and they have been rehearsed.

## Narration

Short sentences, one idea per breath, a pause after "Zero." and after "It's a settled payment."

- **Hook:** "Every dollar a brand spends on creators is a bet. They pay for clicks, and bots click. So the brand pays for traffic that never buys, and the creator who actually sells is paid the same as a click farm. What if a creator got paid only when money moved? This is numa."
- **Creator:** "I'm a creator. I publish a profile and an offer, I get approved, and I get a link. That link is my whole business. My reputation isn't a number I typed in; it only counts sales that match an on-chain event."
- **Merchant:** "I made a campaign: 10% commission, locked on-chain. Approving a creator doesn't move money or hold money. Your funds never sit in an escrow."
- **Buyer:** "I clicked the creator's link and I want this. Watch my wallet: zero gas token. Zero. On a normal chain this payment is impossible. One signature, I'm not sending a transaction, I'm authorizing a payment, and numa's relayer submits it." On the explorer: "Merchant net. Protocol fee. And the creator's commission, which the contract is holding, not us."
- **Refund window:** "Refunds are real. For 60 seconds in this demo, a refund claws the commission back. If there's none, the contract pays the creator automatically. No invoice, no chasing. That clock is chain time; nobody can rush it."
- **Receipt:** "Every sale gets a public receipt, the merchant gets an accountant-ready CSV, and the creator's reputation counts this sale because the chain says it happened."

## Do not say or show

- No claims of mainnet use, real users or volume; it is a testnet.
- Do not say "trustless". The relayer is a service; the contract-level guarantees are what hold.
- Do not open `.env` or any key file on screen.
- Do not present recorded footage as live. A fallback recording is for emergencies only, and must be labelled.

## Preconditions

- [x] Contracts deployed and verified; addresses in `packages/shared/src/addresses.ts` and `.env.example` (`WHITECHAIN.md`)
- [ ] **Campaign created on-chain** with `payoutSigner` = the merchant-signer address, and a creator approved
- [ ] **One real USDT payment** through the deployed router from a buyer with zero WBT; the explorer link goes in the README (the Whitechain track requires it)
- [ ] Relayer wallet funded with WBT; Arkiv writer funded with tGLM
- [ ] `seed:demo` run so discovery screens are populated (its `[DEMO]` rows are labelled, and unverified on-chain)
- [x] Checkout component built (`@numa/sdk-react`, `apps/demo-shop`); [ ] run it against the deployed stack with a real wallet that holds test USDT and zero WBT
- [ ] Frontend gaps wired: link resolution (`/links/:code`), the creator's own offers (`/creators/:address/offers`), merchant offer review (`/campaigns/:id/offers`)
- [ ] Hosted API awake (free Render tier sleeps; open `/health` a few minutes before recording)
- [ ] At least one rehearsed end-to-end run on the real chain, timed against the 60 s refund window
