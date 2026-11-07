# Security and threat model

"Built" means implemented and covered by tests against local or mocked chains. **Nothing here has been exercised against a deployed contract.** Hackathon testnet MVP, not audited.

| Threat | Mitigation | Status |
|---|---|---|
| Relayer abused for arbitrary calls | Fixed target and function: only `payOrder` / `release` on the configured router; requests cannot choose a contract or calldata | built |
| Relayer drained via gas | gas price ceiling, daily cap, per-address limit, rate limit, simulate-first; the keeper shares the same cap | built (Postgres-backed when `DATABASE_URL` is set, in-memory otherwise) |
| Duplicate or replayed orders | relayer claim by `orderId`; router rejects an already-settled `orderId`; EIP-3009 nonce is the `OrderCommitment` of the full order and split | built |
| Forged or mismatched buyer authorization | the relayer recovers the EIP-3009 signer locally and requires it to equal `buyer` for this exact order, amount, router and recomputed nonce | built |
| Swapping creator, campaign or terms after the buyer signed | the buyer's nonce commits to campaign, merchant, creator, buyer, gross, `commissionBps`, `feeBps`, `orderId` and deadline (ADR 0005) | built |
| Front-running the buyer's authorization | `receiveWithAuthorization` requires the caller to be the recipient (the router) | token behaviour verified; flow untested live |
| Forged orders | router recovers the EIP-712 merchant signature and requires it to equal the campaign's on-chain `payoutSigner` | built |
| Fake conversions on Arkiv | a conversion counts only if owned by the Numa writer **and** matching an `OrderSettled` event | built |
| Fake links, decisions, invites, campaigns on Arkiv (anyone can write any entity) | readers filter by expected owner (`ownedBy`); campaign/invite ownership is compared with `CampaignRegistry.getCampaign(id).merchant`; unknown is reported as `null`, never `true` | built (registry untested live) |
| Fake endorsements or smearing | author must be the order's merchant in `OrderSettled`; one per order | built |
| Spoofed negotiation messages or a hijacked agent | a message counts only if written by the principal or by an agent named in a live `numa.agent` entity owned by that principal; accepts must name the other side's last rate | built (live Arkiv checked) |
| Agent over-concession or prompt injection | a rules engine enforces private guardrails and the campaign's own cap; the LLM (Gemini or Claude) only phrases a note, its output is dropped if it states a different figure, and counterparty text is never fed to the engine; the Gemini key travels only in a header, never the URL | built (real LLM untested) |
| Reading or changing someone's agent policy | every read and write needs a fresh EIP-191 signature from the principal (5 minute window, action bound into the message) | built |
| Reentrancy and accounting bugs | CEI, `ReentrancyGuard`, `SafeERC20`, fuzzed invariants (held + released + clawed = commission) | built (local tests) |
| Key leakage | keys only in env or keystore; never in the repo or logs; `.env` is gitignored | process |
| Wash trading (self-purchase via other wallets), sybils, merchant collusion, refund abuse | **Not prevented.** Reputation weighs distinct payers but cannot prove authenticity | known limitation |
| Relayer downtime or out of WBT | `/health` exposes its balance; checkout fails closed | partial |
| Arkiv lag or outage | money state is read from chain events, not Arkiv | built |

## Keys
- The **relayer key** is a hot key: fund it with minimal WBT and never reuse the merchant or deployer key.
- The **Arkiv writer** and the **agent wallet** hold only tGLM and can only write Arkiv entities. The agent wallet has no authority over funds, the router or the registry.
- Never print, log or commit private keys.

## Reporting
This is a hackathon project. Open an issue on the repository for anything you find.
