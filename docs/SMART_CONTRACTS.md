# Smart Contracts

Owner: Member 1 (`packages/contracts`, branch `feat/contracts`). Status: implemented and tested
on a local Foundry chain (41/41 tests passing, including a 512-run fuzz invariant). **Not yet
deployed to Whitechain Sepolia** — see "Deployment" below and `docs/PROJECT_STATUS.md`.

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

#### `refund(orderId, refundAmount)`

Merchant-only, only before `release`. See the ADR for the full accounting — in short: the
maximum refundable amount for an order is `gross - fee` (the protocol fee is never refunded); the
held commission is clawed back proportionally to fund part of the refund, and the merchant's
standing USDT allowance to the router funds the rest.

#### `release(orderId)`

Callable by anyone once `block.timestamp >= paidAt + refundWindow`. Pays the remaining held
commission to the creator, marks the order released. Reverts on a second call.

## Events (handoff to Member 2 / Member 3 per `TEAM.md`)

- `OrderSettled(orderId, campaignId, merchant, creator, buyer, gross, merchantNet, commission, fee)`
- `OrderRefunded(orderId, refundAmount, commissionClawback, merchantPulled)`
- `CommissionReleased(orderId, creator, amount)`
- `CampaignCreated`, `CreatorApproved`, `CreatorRevoked`, `CampaignPaused` (CampaignRegistry)

ABIs are exported to `packages/shared/src/abis/` (`CampaignRegistry.json`, `NumaRouter.json`),
regenerated from `packages/contracts/out/` after any contract change. TypeScript mirrors of the
`Order` struct and EIP-712 typed-data definition live in `packages/shared/src/contracts-types.ts`.
Deployed addresses go in `packages/shared/src/addresses.ts` once deployed (currently empty).

## Security measures implemented

- `ReentrancyGuard` on all three state-changing functions.
- `SafeERC20` for every token transfer/transferFrom.
- EIP-712 signature verification for merchant orders (OpenZeppelin `EIP712` + `ECDSA`).
- EIP-3009 authorization for buyer payments (no buyer WBT, no buyer approval needed).
- Replay protection: `orderId` can only be settled once; EIP-3009 `authNonce` is tracked by the
  token itself (`authorizationState`).
- Order deadline and campaign `endsAt` enforcement.
- Commission capped at 50% (registry), protocol fee capped at 1% (router), both at construction
  or campaign-creation time — not owner-adjustable after the fact (no admin key to misuse).
- `usdt` address is `immutable`.
- All payout arithmetic is integer-only, rounds down, and is covered by a fuzz test
  (`testFuzz_payOrder_splitInvariant`, 512 runs) asserting `merchantNet + commission + fee ==
  gross` for arbitrary gross/commissionBps/feeBps within their valid ranges.

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

41 tests across `test/CampaignRegistry.t.sol` and `test/NumaRouter.t.sol`: unit tests for every
access-control and validation branch, plus a fuzz test for the payout-split invariant and fuzz
tests for commission bounds. `test/mocks/MockUSDT.sol` is a minimal EIP-3009 token mirroring the
behavior verified against the real Whitechain testnet USDT in `docs/WHITECHAIN.md` (6 decimals,
`receiveWithAuthorization` requires `msg.sender == to`).

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
