# Security & threat model

| Threat | Mitigation | Status |
|---|---|---|
| Relayer abused for arbitrary calls | Fixed target + function; request cannot pick contract/calldata | built |
| Relayer drained via gas | gas price ceiling, daily cap, per-address limit, rate limit, simulate-first | built (in-memory limits) |
| Duplicate/replayed orders | relayer claim by orderId; router single-use orderId; EIP-3009 nonce bound to digest+creator | relayer built; router planned |
| Relayer submitting a mismatched/forged buyer authorization | recovered EIP-3009 signer must equal `buyer` for this exact order (amount, router, derived nonce) | built (mocked chain) |
| Front-running the buyer's authorization | `receiveWithAuthorization` requires caller == recipient (router) | token-verified, flow untested |
| Forged orders | EIP-712 merchant signature checked against campaign payout signer on-chain | planned |
| Fake conversions on Arkiv | conversion entities trusted only if owned by Numa writer **and** matching `OrderSettled` | planned |
| Fake links/decisions on Arkiv | readers filter by expected owner (`ownedBy`) | built |
| Spoofed Arkiv campaigns/invites (anyone can write entities) | owner compared with on-chain `CampaignRegistry.merchantOf`; unknown reported as `null` | built (mocked; registry not written) |
| Fake endorsements / smearing | author must be the order's merchant in `OrderSettled`; one per order | built (mocked chain) |
| Key leakage | keys only in env/keystore; never in repo/logs; `.env` gitignored | process |
| Reentrancy / accounting bugs | CEI, ReentrancyGuard, SafeERC20, fuzzed invariants | planned |
| Wash trading (self-purchase via other wallets), sybils, merchant collusion, refund abuse | **Not prevented**; reputation weights distinct payers but cannot prove authenticity | known limitation |
| Relayer downtime / out of WBT | `/health` exposes balance; checkout fails closed | partial |
| Arkiv lag/outage | money state read from chain events | planned |

Relayer key is a hot key: fund with minimal WBT. Never run it with the merchant or deployer key.
