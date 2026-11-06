# ADR 0006: Pre-deployment audit hardening (constructor validation, EVM target)

Status: Accepted
Date: 2026-11-07
Owner: Member 1 (contracts)

## Context

A pre-deployment security and readiness audit (ahead of the first Whitechain Sepolia testnet
deployment) reviewed `NumaRouter.sol`/`CampaignRegistry.sol` against authorization/signature
correctness, financial correctness, access control, and operational-security checklists. Two
categories of fix were identified as justified, low-risk, and squarely within "harden against
deployment-time mistakes" rather than any change to business rules or economic parameters:

1. **Wrong EVM target for the deployment chain.** Whitechain Sepolia and Whitechain Mainnet both
   require `evmVersion` set to `prague` (confirmed directly from `docs.whitechain.io/learn/network/reference.md`
   and the official Foundry deploy guide, both independently re-fetched during this audit) — "the
   highest EVM target that runs on both." `foundry.toml` had no explicit `evm_version`, so `solc`
   would use whatever its own default target is for the pinned compiler version, which is not
   guaranteed to match what Whitechain's OP Stack sequencer supports, and — independent of runtime
   compatibility — Blockscout verification matches compiled bytecode, which depends on
   `evm_version`, not just `solc` version. An unverified-but-undeployed contract is a weaker
   deployment than a mismatch caught at build time.
2. **No deployment-time sanity checks for constructor arguments that are not business parameters
   but are still easy to get wrong by hand.** `usdt_`/`registry_` were previously checked only for
   non-zero, not for actually being contracts — a copy-paste or chain-ID mix-up (e.g. pasting a
   Whitechain Sepolia address while connected to a different chain, or transposing two addresses)
   would deploy successfully and only fail later, on the very first `payOrder` call, wasting a
   deployment. `refundWindow_` had no upper bound at all — an accidental extra zero (e.g. `864000`
   intended as `86400`) would still deploy successfully and only become apparent when `release()`
   turns out to be uncallable for an implausibly long time, permanently stranding every order's
   held commission until then.

## Decision

### `evm_version = "prague"` in `packages/contracts/foundry.toml`

Matches Whitechain's own documented requirement exactly. Verified compatible with the existing
pinned `solc = "0.8.28"` (accepted without error) and does not change test outcomes (49/49 passed
before and after). No contract source change required for this fix.

### Constructor-time validation in `NumaRouter.sol`

```solidity
require(usdt_.code.length > 0, "NumaRouter: usdt is not a contract");
require(registry_.code.length > 0, "NumaRouter: registry is not a contract");
require(refundWindow_ <= MAX_REFUND_WINDOW, "NumaRouter: refund window too long"); // MAX_REFUND_WINDOW = 365 days
```

`code.length > 0` is a minimal, cheap (one-time, constructor-only) sanity check that the address
is at least *some* contract — it cannot and does not verify the contract implements the correct
interface (EIP-3009 for `usdt_`, `ICampaignRegistry` for `registry_`); that level of verification
belongs in the deployment script (off-chain, pre-broadcast), not on-chain, since on-chain interface
probing is unreliable and adds gas/complexity for no real safety gain. This check exists purely to
catch the cheapest, most common mistake (an EOA or wrong-chain address) at the cheapest possible
point (deployment, before any real funds are ever at risk) rather than at the first real `payOrder`.

`MAX_REFUND_WINDOW = 365 days` is a sanity ceiling, not a business-rule choice — it does not
restrict any legitimate configuration (including a `0`-second or `60`-second demo window, both
still explicitly allowed and tested) and does not change `refund()`/`release()` semantics or the
accepted merchant-funded-pull refund model (`docs/DECISIONS/0001-refund-funding-model.md`) in any
way. It only prevents the constructor from accepting a value no real deployment would ever
intentionally use.

## Consequences

- No change to `payOrder`/`refund`/`release` logic, the `OrderCommitment` design
  (`docs/DECISIONS/0005-order-commitment-nonce-binding.md`), fee/commission math, or any economic
  parameter.
- Deploying with a wrong `usdt_`/`registry_` address (EOA, zero-code address, or a contract that
  happens to have *some* code but isn't the intended one) now fails loudly at deploy time for the
  EOA/zero-code case; a wrong-but-also-a-contract address (e.g., pointing at the wrong token
  entirely) is still only caught by the deployment script's own pre-broadcast interface checks (see
  `script/Deploy.s.sol`), not by this constructor check — `code.length > 0` is a floor, not a full
  interface guarantee.
- 5 new regression tests added (`test_constructor_revertsOnEOAUsdt`,
  `test_constructor_revertsOnEOARegistry`, `test_constructor_revertsOnRefundWindowTooLong`,
  `test_constructor_allowsExactlyMaxRefundWindow`, `test_constructor_allowsZeroRefundWindow`).
- `forge fmt --check` now passes (previously failing, pre-existing, unrelated formatting drift
  fixed as part of this same pass since it was blocking the project's own CI gate).

## Additional fix, applied after explicit product-owner approval

- **Merchant could approve themselves as their own creator** (`approveCreator(campaignId,
  merchant)`), letting a merchant collect commission on their own sale. Not a fund-safety issue (no
  theft, no incorrect accounting) — a specific instance of the already-documented "merchant
  collusion is out of scope" trust assumption (`docs/SMART_CONTRACTS.md` → Trust assumptions). This
  is a business-rule change, so it was explicitly surfaced to the product owner rather than fixed
  unilaterally; approved on 2026-11-07. `CampaignRegistry.approveCreator` now reverts with
  `"CampaignRegistry: merchant cannot be own creator"` when `creator == msg.sender` (equivalent to
  `creator == campaign.merchant`, already enforced by the `onlyMerchant` modifier). One new
  regression test: `test_approveCreator_revertsOnSelfDealing`.

## Findings considered and explicitly NOT fixed here (see the full audit report)

- **No token-rescue function** for USDT (or any token) accidentally sent directly to the router.
  Deliberately not added: it would reintroduce a privileged withdrawal function, directly
  contradicting the router's existing "no admin/owner role, no withdrawal function outside
  `payOrder`/`refund`/`release`" security property. Documented as a known limitation instead.
- **No pause mechanism on `NumaRouter` itself** (only per-campaign pause via `CampaignRegistry`).
  Already documented as an accepted hackathon-MVP limitation; unchanged by this audit.
- **Dust orders can round commission/fee to zero** for very small `gross` values. Integer-rounding
  behavior, not a fund-safety issue (the fuzz-tested split invariant `merchantNet + commission +
  fee == gross` holds regardless) — informational only.
