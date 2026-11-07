# Whitechain

| | |
|---|---|
| Network | Whitechain Sepolia, chain id **1874** (verified via `cast chain-id`) |
| RPC | https://rpc.testnet.whitechain.io (50 rps/IP) |
| Explorer | https://explorer.testnet.whitechain.io |
| Native gas | WBT |

## Test USDT — verified 2026-11-06
Address `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (from the brief) — checked on-chain:
- `name()="Tether USD"`, `symbol()="USDT"`, `decimals()=6`.
- It is an **EIP-1967 proxy**; implementation `0x26425662d126412128967ecf0a02ec48573026f7`.
- Implementation bytecode contains selectors for `receiveWithAuthorization` (both `v,r,s` 0xef55bec6 and `bytes signature` 0x88b7ab63), `transferWithAuthorization`, `authorizationState`, `permit`, `nonces`, `DOMAIN_SEPARATOR`, `mint`.
- EIP-712 domain (derived and matched against `DOMAIN_SEPARATOR()`): `name="Tether USD"`, `version="1"`, `chainId=1874`, `verifyingContract=<proxy address>`.

**Conclusion:** EIP-3009 gasless flow is feasible. Still to prove with a real `receiveWithAuthorization` transfer through a deployed router. Note: `receiveWithAuthorization` requires `msg.sender == to`, so NumaRouter must be the caller and recipient.
Not yet verified: explorer-published source for the implementation; WBT faucet steps (see `.agents/skills/whitechain-dev/references/claim-testnet-wbt.md`).

## Deploy
Use Foundry keystore (`cast wallet import <name> --interactive`) — run by a human. See `.agents/skills/whitechain-dev/references/deploy-contract.md`.

## Deployment status
Deployed by Member 1 and **checked on-chain on 2026-11-07**:

| | |
|---|---|
| `CampaignRegistry` | [`0xD924385D22626dB2894D25b5f12253BC36148425`](https://explorer.testnet.whitechain.io/address/0xd924385d22626db2894d25b5f12253bc36148425) (explorer: verified) |
| `NumaRouter` | [`0x51fCf8F50ABB17a0d4D70BA14B4F6394A583c2Fc`](https://explorer.testnet.whitechain.io/address/0x51fcf8f50abb17a0d4d70ba14b4f6394a583c2fc) (explorer: verified) |
| Test USDT | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |
| Deployed in block | 12414186 (both), by `0x9dC62Bef98095eB2Bef9C8E9d5432C989115Df39` |
| Config read from the router | `registry()` and `usdt()` match the above, `feeBps` 50 (0.5%), `refundWindow` 60 s, fee recipient `0x83d7B74fC373e183c6aC32793fb9435657eAd3BA` |

`pnpm --filter @numa/api preflight` passes every contract check against these addresses; its only failure at the time was the relayer wallet holding 0 WBT. The addresses are in `packages/shared/src/addresses.ts` and `.env.example`.

## Whitechain hackathon tracks: where numa fits
Primary: **Scale · Payments Nobody Notices** (gasless checkout; the merchant covers gas through EIP-3009 and our own relayer). Close second: **Operate · Stablecoin Payments for Business** (a drop-in checkout with refunds and an on-chain receipt for both merchant and customer). Not a fit: Tokenize (no RWA) and Continuity (not a pre-existing product). Confirm with the organisers whether one team may enter more than one track.

### Why this flow needs on-chain USDT settlement on Whitechain
The payment, the three-way split (merchant net, creator commission, protocol fee) and the held-then-released commission are enforced by `NumaRouter` in one atomic transaction, so a creator can prove a sale settled from the public chain without trusting the merchant or the platform. A card or bank rail cannot split a single payment to an unaffiliated third party at settlement, cannot hold and release that third party's share against a refund window, and cannot give anyone a publicly checkable receipt. Gasless EIP-3009 means the buyer needs only USDT.

### What the Scale track asks, answered from the code
| Question | Answer |
|---|---|
| Who pays gas? | The relayer wallet (`RELAYER_PRIVATE_KEY`) pays WBT for `payOrder` and, via the keeper, `release`. The buyer holds zero WBT. |
| How does the relayer get its WBT? | From the Whitechain faucet on testnet (https://faucet.testnet.whitechain.io); `/health` shows its balance. **Replenishment from protocol-fee revenue is a design idea, not built.** |
| What stops it being drained? | It can only call `payOrder`/`release` on one configured router. It rejects a request locally unless the merchant's order signature and the buyer's EIP-3009 authorization verify for that exact order, simulates before sending, and enforces a gas-price ceiling, a daily WBT cap (shared with the keeper), a per-address daily limit and an HTTP rate limit. A forged or bad request costs nothing: it fails before any transaction is sent. See `RELAYER.md` and `SECURITY.md`. |

### Qualification checklist (status as of 2026-11-07)
| Requirement | Status |
|---|---|
| Contracts deployed on Whitechain Sepolia (1874) and **verified on the explorer** | **Done.** Deployed and listed as verified by the explorer (see the table above). Re-check the verification status before submitting |
| At least one real USDT payment (`0xcedf…55a7`) settled through the main flow, **explorer link in the README** | **Not done.** No link exists yet; none will be invented |
| README line on why on-chain stablecoin settlement | Done (section above, mirrored in the README) |
| Public repo with steady commit history | Repo is currently private; history is incremental |
| README explaining setup, architecture, limitations | Done (`README.md`, `ARCHITECTURE.md`) |
| Demo video, 2 to 4 minutes, every party shown (merchant, creator, buyer) | Not done (`DEMO.md` has the plan) |
| `WHITECHAIN_FEEDBACK.md` | Drafted from what we actually observed; the deployment experience still needs adding (marked inside) |
| "A drop-in piece a separate demo app adds in about 20 lines" (what judges want to see) | Built: server SDK, React `<NumaCheckout />`, and a demo shop that adds it in about 20 lines (`SDK.md`). Not yet run against a deployed router or a real wallet |
| Free Ankr RPC for hackers (1,500 req/s for 7 days) | Not activated. Worth doing: the indexer and keeper poll the RPC, and the public endpoint is limited to 50 req/s per IP |

