# Smart Contracts

Owner: Member 1 (`packages/contracts`, branch `feat/contracts`). Status: implemented and tested
on a local Foundry chain (49/49 tests passing, including two 512-run fuzz invariants). **Not yet
deployed to Whitechain Sepolia** — see "Deployment" below and `docs/PROJECT_STATUS.md`. **Not yet
integrated with the backend/relayer** — see `docs/PROJECT_STATUS.md` → "Interface reconciliation"
for a list of concrete gaps between this implementation and the backend's pre-implementation
proposal (`packages/shared/src/order.ts`, `abi.ts`).

## Contracts

### `CampaignRegistry.sol`

Holds campaign terms and creator approvals. Holds no funds.

- `createCampaign(payoutSigner, commissionBps, endsAt) -> campaignId`: `commissionBps` is capped
  at `MAX_COMMISSION_BPS = 5000` (50%); `endsAt` must be in the future. **Campaign terms
  (`payoutSigner`, `commissionBps`, `endsAt`) are immutable for the campaign's lifetime** — a
  merchant that wants different terms creates a new campaign. This is a deliberate design choice:
  it means an approved creator's terms can never be silently changed mid-campaign, and an
  in-flight signed order can never be invalidated by a terms edit. Only `pause` and creator
  approval/revocation are mutable, both merchant-only.
- `approveCreator(campaignId, creator)` / `revokeCreator(campaignId, creator)`: merchant-only.
- `pause(campaignId, paused)`: merchant-only; a paused campaign fails `isSettleable`.
- `getCampaign(campaignId) -> Campaign` / `isCreatorApproved(campaignId, creator) -> bool` /
  `isSettleable(campaignId) -> bool`: public views. **Note:** there is no `merchantOf(campaignId)`
  function — the merchant address is a field on the `Campaign` struct returned by `getCampaign`
  (`getCampaign(campaignId).merchant`). An earlier backend proposal assumed a `merchantOf`
  function that was never implemented; see `docs/PROJECT_STATUS.md` → "Interface reconciliation."
- `isSettleable(campaignId) -> bool`: `exists && !paused && block.timestamp <= endsAt`. NumaRouter
  checks this before every settlement.

### `NumaRouter.sol`

Settles gasless USDT orders. See `docs/DECISIONS/0001-refund-funding-model.md` for the refund
funding model in full. Immutable at construction: `usdt`, `registry`, `feeRecipient`, `feeBps`
(capped at `MAX_FEE_BPS = 100`, i.e. 1%), `refundWindow`.

#### `payOrder(order, merchantSignature, validAfter, validBefore, authNonce, v, r, s)`

1. Checks: order not expired, order ID not already settled, buyer ≠ merchant, buyer ≠ creator,
   gross > 0.
2. Loads the campaign from `CampaignRegistry`; requires it exists, is settleable, and that
   `order.merchant` matches the campaign's merchant.
3. Requires the creator is approved on the campaign.
4. Recovers the EIP-712 order signer and requires it equals the campaign's `payoutSigner` (a
   dedicated signing key per campaign, decoupled from the merchant's wallet).
5. Calls `IERC3009(usdt).receiveWithAuthorization(buyer, address(this), gross, ...)` — this
   contract must be both caller and recipient, per EIP-3009's `msg.sender == to` requirement.
6. Computes `commission = gross * commissionBps / 10000`, `fee = gross * feeBps / 10000`,
   `merchantNet = gross - commission - fee` (integer division, rounds down).
7. Records the `Settlement`, pays `merchantNet` to the merchant and `fee` to `feeRecipient`
   immediately, holds `commission` in the contract.
8. Emits `OrderSettled`.

`payOrder` is permissionless (any address, typically the relayer, may call it) — the buyer's
EIP-3009 signature and the merchant's EIP-712 signature are what authorize the settlement, not
`msg.sender`. Relayer-side allowlisting, rate limiting and spend caps are an operational concern
for Member 2, not enforced on-chain.

**`authNonce` must equal `computeOrderCommitment(order, campaign.commissionBps, feeBps)`.** This
is checked (step 4.5, after the merchant-signature check, before the EIP-3009 call) via:

```solidity
bytes32 expectedCommitment = computeOrderCommitment(order, campaign.commissionBps, feeBps);
require(authNonce == expectedCommitment, "NumaRouter: authNonce does not match order commitment");
```

`computeOrderCommitment` is a `public view` function computing an EIP-712 digest (router domain,
`ORDER_COMMITMENT_TYPEHASH`) over `{campaignId, merchant, creator, buyer, gross, commissionBps,
feeBps, orderId, deadline}`. This binds the buyer's EIP-3009 authorization to the complete order
and split terms — without it, a buyer's authorized payment (which EIP-3009 alone only ties to
`from`/`to`/`value`/a window) could be paired by the relayer (or anyone, since `payOrder` is
permissionless) with a *different*, independently merchant-signed order of the same `gross`,
redirecting the commission/merchant-net split. See
`docs/DECISIONS/0005-order-commitment-nonce-binding.md` for the full design rationale, the fields
deliberately excluded (`feeRecipient`, the token address — both immutable-and-domain-pinned
already), and why there's no circular hash dependency. **Field order and types must exactly match
between Solidity and TypeScript** — `commissionBps`/`feeBps` are `uint96`, not `uint256`; a width
mismatch in the type string silently produces a non-matching digest. A fixed cross-language test
vector (same inputs, same expected digest, asserted independently in both
`test/NumaRouter.t.sol::test_fixedVector_orderCommitmentMatchesCrossLanguageSpec` and — once
implemented — a matching TypeScript test in `packages/shared`) is the mechanism for catching any
such divergence.

#### `refund(orderId, refundAmount)`

Merchant-only, only before `release`. See the ADR for the full accounting — in short: the
maximum refundable amount for an order is `gross - fee` (the protocol fee is never refunded); the
held commission is clawed back proportionally to fund part of the refund, and the merchant's
standing USDT allowance to the router funds the rest.

#### `release(orderId)`

Callable by anyone once `block.timestamp >= paidAt + refundWindow`. Pays the remaining held
commission to the creator, marks the order released. Reverts on a second call.

## Events (handoff to Member 2 / Member 3 per `TEAM.md`)

- `OrderSettled(orderId indexed, campaignId indexed, merchant indexed, creator, buyer, gross, merchantNet, commission, fee)`
- `OrderRefunded(orderId indexed, refundAmount, commissionClawback, merchantPulled)`
- `CommissionReleased(orderId indexed, creator indexed, amount)`
- `CampaignCreated`, `CreatorApproved`, `CreatorRevoked`, `CampaignPaused` (CampaignRegistry)

Indexed-parameter positions matter for any code decoding these events by topic position rather
than by field name — an earlier backend ABI proposal indexed `creator` instead of `merchant` as
the third `OrderSettled` topic; see `docs/PROJECT_STATUS.md` → "Interface reconciliation."

ABIs are exported to `packages/shared/src/abis/` (`CampaignRegistry.json`, `NumaRouter.json`),
regenerated from `packages/contracts/out/` after any contract change. TypeScript mirrors of the
`Order` struct and EIP-712 typed-data definition live in `packages/shared/src/contracts-types.ts`,
re-exported from `@numa/shared` as `NumaRouterOrder` (see `docs/PROJECT_STATUS.md` for why it's
renamed at the barrel export). Deployed addresses go in `packages/shared/src/addresses.ts` once
deployed (currently empty).

## Security measures implemented

- `ReentrancyGuard` on all three state-changing functions.
- `SafeERC20` for every token transfer/transferFrom.
- EIP-712 signature verification for merchant orders (OpenZeppelin `EIP712` + `ECDSA`).
- EIP-3009 authorization for buyer payments (no buyer WBT, no buyer approval needed).
- Replay protection: `orderId` can only be settled once; EIP-3009 `authNonce` is tracked by the
  token itself (`authorizationState`).
- `authNonce` must equal `computeOrderCommitment(order, campaign.commissionBps, feeBps)` — binds
  the buyer's authorized payment to the complete order and split terms, preventing a relayer (or
  anyone, since `payOrder` is permissionless) from settling a different order with a buyer's
  authorization. See `docs/DECISIONS/0005-order-commitment-nonce-binding.md`.
- Order deadline and campaign `endsAt` enforcement.
- Commission capped at 50% (registry), protocol fee capped at 1% (router), both at construction
  or campaign-creation time — not owner-adjustable after the fact (no admin key to misuse).
- `usdt` address is `immutable`.
- All payout arithmetic is integer-only, rounds down, and is covered by a fuzz test
  (`testFuzz_payOrder_splitInvariant`, 512 runs) asserting `merchantNet + commission + fee ==
  gross` for arbitrary gross/commissionBps/feeBps within their valid ranges.
- Constructor validates `usdt_`/`registry_` are deployed contracts (`code.length > 0`), not just
  non-zero addresses, and caps `refundWindow_` at `MAX_REFUND_WINDOW` (365 days) — catches the
  cheapest deployment-time mistakes (EOA/wrong-chain address, fat-fingered refund window) before
  any funds are ever at risk. See `docs/DECISIONS/0006-pre-deployment-audit-hardening.md`.
- `foundry.toml` pins `evm_version = "prague"`, matching Whitechain's documented requirement for
  both Sepolia and Mainnet — avoids a compiler-target/verification mismatch at deploy time.
- `CampaignRegistry.approveCreator` rejects a merchant approving themselves as their own creator
  (`creator == msg.sender`), closing a self-dealing path to manufacture fake commission-bearing
  conversions. See `docs/DECISIONS/0006-pre-deployment-audit-hardening.md`.

## Invariants

Proven by the test suite (see "Testing" below):
- `merchantNet + commission + fee == gross` for any valid `gross`/`commissionBps`/`feeBps`
  (`testFuzz_payOrder_splitInvariant`, 512 fuzz runs).
- An order can only settle once (`test_payOrder_revertsOnReplay`) and only release once
  (`test_release_revertsOnDoubleRelease`).
- `heldCommission` after N refunds equals `commission` minus the sum of each refund's clawback,
  and a refund of the full refundable base claws back exactly the full held commission and pulls
  exactly `merchantNet` from the merchant, never more (`test_refund_maxRefundableClawsBackEntireCommission`).
- `computeOrderCommitment`'s digest never collides with the `Order` EIP-712 signing digest for any
  field values (`testFuzz_orderCommitmentNeverCollidesWithOrderDigest`, 512 fuzz runs) — guards
  against a future refactor accidentally reusing one typehash for both purposes.
- An order/creator/campaign substitution attack (pairing a buyer's authorization with a different,
  independently valid order of the same `gross`) is rejected
  (`test_payOrder_rejectsCreatorSubstitution`, `test_payOrder_rejectsCampaignAndMerchantSubstitution`,
  `test_payOrder_rejectsOrderIdSubstitution`).

Structurally true but **not yet explicitly fuzzed across multiple concurrent orders**: the
router's USDT balance should always be ≥ the sum of `heldCommission` across all unreleased orders
(each order's accounting is independent and per-`orderId`-keyed, so this should hold by
construction, but no test asserts it as a cross-order aggregate property). Worth adding if the
contracts are revisited.

## Trust assumptions

- The campaign's `payoutSigner` is trusted to sign only legitimate orders on the merchant's
  behalf — a malicious or compromised payout signer can authorize arbitrary settlements for that
  campaign (bounded by the campaign's own `commissionBps` and the creator-approval/settleability
  checks). A merchant can no longer approve themselves directly as their own creator
  (`docs/DECISIONS/0006-pre-deployment-audit-hardening.md`), but collusion via a *different*,
  independently-approved creator who kicks back the commission remains out of scope for the
  contracts — see `README.md` → Known limitations.
- The USDT token is assumed to behave as a standard, non-hook, non-rebasing ERC-20 with a correct
  EIP-3009 implementation, as independently verified against Whitechain testnet USDT in
  `docs/WHITECHAIN.md`. The token's own proxy admin could in principle change its implementation;
  the router has no way to detect or defend against that.
- The router holds no admin/owner role and has no withdrawal function outside the normal
  `payOrder`/`refund`/`release` flows — there is no privileged party who can move held funds
  other than through those three functions' normal accounting.

## Known limitations (see also `README.md` and `initial-prompt.md` §21)

- `refund()` requires the merchant to maintain a sufficient USDT allowance to `NumaRouter`. If the
  merchant revokes or exhausts it, refunds revert — this does not affect settlement integrity
  (the buyer's original payment already settled on-chain), but it is an operational dependency
  the frontend/SDK must surface during merchant onboarding.
- `block.timestamp` is used for deadlines and the refund window; validator timestamp manipulation
  is a theoretical griefing vector on any EVM chain using this pattern, bounded to the scale of
  a few seconds and not considered a practical risk at these time scales (deadlines in
  hours/days, refund windows in hours+).
- No pausability on `NumaRouter` itself (only on individual campaigns via `CampaignRegistry`) — a
  critical bug would require a new deployment, not an emergency pause. Acceptable for a hackathon
  MVP; flagged for a production follow-up.

## Testing

```
pnpm contracts:build
pnpm contracts:test
```

55 tests across `test/CampaignRegistry.t.sol` and `test/NumaRouter.t.sol`: unit tests for every
access-control and validation branch, a fuzz test for the payout-split invariant, fuzz tests for
commission bounds, and 8 tests covering the `OrderCommitment` nonce binding (see
`docs/DECISIONS/0005-order-commitment-nonce-binding.md`) — including direct reproductions of the
order/creator/campaign-substitution attacks it prevents, sensitivity checks for `commissionBps`/
`feeBps`, a fuzz test confirming the commitment digest never collides with the `Order` signing
digest, and a fixed cross-language test vector
(`test_fixedVector_orderCommitmentMatchesCrossLanguageSpec`) with a literal hardcoded expected
digest for independent verification against a matching TypeScript test. `test/mocks/MockUSDT.sol`
is a minimal EIP-3009 token mirroring the behavior verified against the real Whitechain testnet
USDT in `docs/WHITECHAIN.md` (6 decimals, `receiveWithAuthorization` requires `msg.sender == to`).
5 of the 54 tests cover the constructor-validation hardening from the pre-deployment audit
(`test_constructor_revertsOnEOAUsdt`, `test_constructor_revertsOnEOARegistry`,
`test_constructor_revertsOnRefundWindowTooLong`, `test_constructor_allowsExactlyMaxRefundWindow`,
`test_constructor_allowsZeroRefundWindow`) — see `docs/DECISIONS/0006-pre-deployment-audit-hardening.md`.

## Deployment

Not yet deployed. Deploying requires a human-controlled Foundry keystore (the agent's shell has
no TTY for the keystore password) — see
`.agents/skills/whitechain-dev/references/deploy-contract.md`. Deploy script:
`packages/contracts/script/Deploy.s.sol`, reading `USDT_ADDRESS`, `FEE_RECIPIENT`, `FEE_BPS`,
`REFUND_WINDOW_SECONDS` from the environment (see `.env.example`). Example:

```
cast wallet import numa-deployer --interactive   # one-time, run by Member 1
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://rpc.testnet.whitechain.io \
  --account numa-deployer \
  --broadcast
```

After a successful deploy, update `packages/shared/src/addresses.ts` and
`CAMPAIGN_REGISTRY_ADDRESS` / `NUMA_ROUTER_ADDRESS` in `.env`, and record the addresses and
transaction hashes in `docs/PROJECT_STATUS.md`.
