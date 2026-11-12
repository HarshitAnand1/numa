# Pitches and slides

Two track pitches of about 90 seconds each, plus an optional four-slide outline. Everything here describes what is built; the two things that must exist before saying them on stage are marked. The demo itself is in [`DEMO.md`](DEMO.md).

## Whitechain pitch

**Angle:** numa makes USDT behave like a real payment rail on Whitechain, and Whitechain is where the proof of conversion lives.

> Whitechain has USDT. What it doesn't have yet is a reason for a merchant to use it at checkout.
>
> numa gives them one. A creator drives a sale and is paid only when real USDT settles on Whitechain. No Stripe, no oracle, no analytics pixel. The settled payment is the proof.
>
> **One.** A buyer with zero WBT can pay. They sign one EIP-3009 authorization on your real USDT contract and our relayer submits it. We rehearsed this on an anvil fork of Whitechain Sepolia against the actual USDT proxy.
>
> **Two.** That rehearsal caught a real out-of-gas bug before launch: the gas estimate was exact and the call failed. We now buffer it by 25%.
>
> **Three.** NumaRouter splits every payment atomically: merchant, creator and a 0.5% protocol fee. The creator's commission is held by the contract through a refund window, then released by a keeper using chain time.
>
> **Four.** Both contracts are deployed and verified on Whitechain Sepolia, with 55 unit, fuzz and invariant tests.
>
> Every sale on numa is a transaction on Whitechain. More creators means more merchants, and more merchants means more USDT volume on your chain. We wrote up what building here was like, including the public RPC limit, in `WHITECHAIN_FEEDBACK.md`.

**Must exist first:** the real USDT payment and its explorer link. Until then say "verified contracts and a fork rehearsal against the real USDT".

**Likely questions**
- *Why not a normal ERC-20 transfer?* The buyer would need WBT for gas. EIP-3009 lets them sign instead.
- *Can the relayer steal funds?* No. It only calls the router, and the buyer's nonce commits to the exact order and split, so it cannot change the creator or amount.
- *What was hard here?* The 50 requests/s per IP public RPC limit and the USDT being an upgradeable proxy whose EIP-712 domain we had to derive (see `WHITECHAIN_FEEDBACK.md`).

## Arkiv pitch  

**Angle:** Arkiv is the marketplace's public memory. It holds everything except the money.

> A creator marketplace needs a lot of shared, public, ownable data: campaigns, offers, profiles, approvals, links. Normally that is a company's database, and the company owns it. In numa it is wallet-owned entities on Arkiv.
>
> **Ownership is real.** A campaign is written by the merchant's wallet, a profile by the creator's. The platform can't edit or fake either, and a creator can take their profile and reputation with them.
>
> **Nothing sensitive lives there.** Arkiv holds no funds and no secrets. Money lives only on-chain. Anyone can write any entity, so every read checks the owner, and for money we check the chain too. A fake conversion entity earns nothing, because reputation counts only entities that match an on-chain `OrderSettled` event.
>
> **We used it properly.** Typed schemas with indexed columns, an expiry on every entity, writes through a serialized safe writer with explicit nonce, gas and gas price, and browser-wallet-style writes verified. The negotiation agents trade offers as Arkiv entities, so the haggle is a public, verifiable thread.
>
> Arkiv gave us a backend where the users own the data. Remove numa tomorrow and the marketplace's records are still there.

**Must exist first:** only mention the negotiation agents if they are enabled on the hosted API (`AGENT_WALLET_PRIVATE_KEY`) and rehearsed. Otherwise drop that sentence.

**Likely questions**
- *What if someone writes a fake entity?* Readers check the owner address, and money claims are cross-checked against the chain.
- *Why also Postgres?* Only for order sessions, the relayer queue and caches. Postgres can't give a creator ownership of their own profile.
- *What was hard?* Queries need at least one indexed filter, so the schema is designed around the queries (see `arkiv/friction.md`).

## Slide outline (optional; the product demo carries the pitch)

Four slides at most. Keep them to one idea each, with large type and no bullet walls.

| # | Slide | Content |
|---|---|---|
| 1 | **Problem** | "Brands pay for clicks. Bots click." One number or line, no logo wall. Shown for the first 15 seconds, then cut to the live demo |
| 2 | **How it works** | One diagram: Buyer signs once, Relayer submits, NumaRouter splits into Merchant net, Creator commission (held, then released) and Protocol fee. Caption: "A settled USDT payment is the proof of conversion" |
| 3 | **Architecture and tracks** | Left: Whitechain (EIP-3009 on the real USDT, NumaRouter, keeper). Right: Arkiv (wallet-owned entities, owner checks, expiry). Underneath: "Money on-chain. Marketplace data on Arkiv." Use this slide for the track judges |
| 4 | **What's next and ask** | Real merchants onboarding, more tokens, creator reputation as a portable credential. Repo link `github.com/HarshitAnand1/numa`, live app link, team names |

Do not add slides for the tech stack, a roadmap of planned features presented as built, or pricing. If time is short, use slides 1 and 4 only and let the demo do the rest.
