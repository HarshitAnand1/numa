# Whitechain Sepolia deployment & first-transaction checklist

Status: prepared, not yet executed. Nothing in this document has been run against a live chain.
See `docs/SMART_CONTRACTS.md` → Deployment and `docs/DECISIONS/0006-pre-deployment-audit-hardening.md`
for the contract-level fixes this checklist assumes are already in place.

## Before you start: rehearse and preflight
- `pnpm --filter @numa/api rehearsal` runs the whole flow on a fork of the chain first (see `DEVELOPMENT.md`). It passed 11/11 on 2026-11-07 and found two real bugs (an out-of-gas relay and blank-env handling) that are now fixed.
- After deploying and filling `.env`, run `pnpm --filter @numa/api preflight -- --campaign <id>` and fix any FAIL before starting the API.

For hosting the API and web apps (Render free tier) after deploying the contracts, see `docs/HOSTING.md`.

## 0. Preconditions

- [ ] `forge build` and `forge test` both pass (55/55 as of this writing; re-run before deploying
      if any contract file has changed since).
- [ ] `forge fmt --check` passes (CI gate).
- [ ] Deployer has a Foundry encrypted keystore account (`cast wallet import <name> --interactive`
      — run by a human, never by an agent shell; see `.agents/skills/whitechain-dev/references/deploy-contract.md`).
- [ ] Deployer address holds test WBT for gas (`cast balance <address> --rpc-url
      https://rpc.testnet.whitechain.io`; claim via the testnet faucet if zero).
- [ ] `.env` (not `.env.example`) has `USDT_ADDRESS`, `FEE_RECIPIENT`, `FEE_BPS`,
      `REFUND_WINDOW_SECONDS`, `EXPECTED_CHAIN_ID=1874` set — no private keys in this file.

## 1. Deploy `CampaignRegistry` + `NumaRouter`

```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://rpc.testnet.whitechain.io \
  --account <deployer-keystore-name> \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.whitechain.io/api/
```

- [ ] Ran **without** `--broadcast` first and reviewed the simulation output (console logs: chain
      ID, deployer balance, both addresses) — treat the dry run as informational, not a deploy.
- [ ] Confirmed `block.chainid` printed is `1874` before re-running with `--broadcast`.
- [ ] Re-ran **with** `--broadcast`; captured `CampaignRegistry:`, `NumaRouter:`, and the
      transaction hash from the console output.
- [ ] `deployments/<chainid>-<timestamp>.json` manifest was written (check it was actually
      produced — the script writes it after both contracts deploy and their post-deploy
      read-back checks pass).
- [ ] Blockscout verification succeeded (`--verify` output, or manual fallback per
      `.agents/skills/whitechain-dev/references/verify-contract.md`).
- [ ] Recorded both addresses in `packages/shared/src/addresses.ts` and `.env`
      (`CAMPAIGN_REGISTRY_ADDRESS`, `NUMA_ROUTER_ADDRESS`).

## 2. Post-deployment on-chain sanity

- [ ] `cast call <router> "usdt()(address)"` returns the expected USDT address.
- [ ] `cast call <router> "registry()(address)"` returns the deployed registry address.
- [ ] `cast call <router> "feeBps()(uint96)"` and `"feeRecipient()(address)"` match the intended
      config.
- [ ] `cast call <registry> "owner()" ` — N/A, registry has no owner/admin role by design; instead
      confirm `createCampaign` is callable by any address (no gate) per the contract's design.

## 3. End-to-end transaction lifecycle (one full happy-path order, testnet funds)

1. [ ] **Campaign setup**: merchant calls `CampaignRegistry.createCampaign(commissionBps, payoutSigner, endsAt)`.
       Record the returned `campaignId`.
2. [ ] **Creator approval**: merchant calls `approveCreator(campaignId, creatorAddress)`. Confirm
       `isCreatorApproved(campaignId, creatorAddress)` returns `true`.
3. [ ] **Merchant order signature**: off-chain, merchant's `payoutSigner` key signs the `Order`
       EIP-712 struct (`campaignId, merchant, creator, buyer, gross, orderId, deadline`) via
       `@numa/sdk-server`'s `OrderSigner`.
4. [ ] **Buyer EIP-3009 authorization**: buyer wallet signs `receiveWithAuthorization` for USDT,
       with `to = NumaRouter address`, `value = gross`, and `nonce = computeOrderCommitment(order,
       campaign.commissionBps, router.feeBps())` — **not** an arbitrary nonce; verify the computed
       commitment matches what `NumaRouter.computeOrderCommitment(...)` returns on-chain before
       the buyer signs (call it as a view first).
5. [ ] **Relayer submission**: relayer calls `payOrder(order, merchantSig, authNonce, validAfter,
       validBefore, buyerSig)`. Confirm the transaction succeeds (status `success`, not `reverted`).
6. [ ] **Receipt inspection**: fetch the transaction receipt; confirm an `OrderSettled` event is
       present with the expected `orderId`, `campaignId`, `merchant`, `creator`, `buyer`, `gross`,
       `merchantNet`, `commission`, `fee` values (fee math: `merchantNet + commission + fee ==
       gross`).
7. [ ] **Balance checks**: confirm USDT balance deltas — buyer down by `gross`, merchant up by
       `merchantNet`, fee recipient up by `fee`; router holds exactly `commission` for this order
       (`getSettlement(orderId).heldCommission`).
8. [ ] **Replay rejection**: attempt to call `payOrder` again with the *same* `order`/`authNonce`/
       `buyerSig` — confirm it reverts (both the on-chain `orderId`-already-settled check and
       the token's own EIP-3009 `authorizationState` should independently block it).
9. [ ] **Event indexing**: confirm the backend indexer (`apps/api`) picks up the `OrderSettled`
       event and reflects it via `/creators/:addr/reputation` or equivalent read endpoint — this
       is the first time the indexer runs against a *real* emitted event rather than a
       synthetic/mocked log (see `docs/PROJECT_STATUS.md` → Backend interface reconciliation).

## 4. Refund scenario (separate test order)

1. [ ] Repeat steps 1–7 above for a second order (`orderId2`).
2. [ ] Merchant approves USDT allowance to `NumaRouter` for at least the refundable amount
       (`refundableBase = gross - fee`) — refunds are merchant-funded pull, not router-funded; see
       `docs/DECISIONS/0001-refund-funding-model.md`.
3. [ ] Call `refund(orderId2, refundAmount)` for a **partial** refund (less than
       `refundableBase`). Confirm: buyer receives `refundAmount`; merchant is pulled
       `refundAmount` from their USDT balance; `heldCommission` is reduced by the proportional
       commission clawback (not 1:1 with `refundAmount`).
4. [ ] Confirm `OrderRefunded` event values match the computed clawback and merchant-pull amounts.
5. [ ] Attempt a refund exceeding the *remaining* refundable base — confirm it reverts.
6. [ ] After the refund window elapses (or immediately, if `REFUND_WINDOW_SECONDS=0` on this test
       deployment), call `release(orderId2)` and confirm the creator receives the remaining
       `heldCommission` and a second `release` call reverts (no double release).

## 5. Sign-off

- [ ] All boxes above checked, OR any skipped step explicitly noted with a reason (e.g., "replay
      rejection not re-tested, already covered by `test_payOrder_revertsOnReplay`").
- [ ] `packages/shared/src/addresses.ts` updated and committed.
- [ ] `docs/PROJECT_STATUS.md` updated to reflect "deployed to Whitechain Sepolia" with the
      addresses, replacing the current "Not yet deployed" language.
