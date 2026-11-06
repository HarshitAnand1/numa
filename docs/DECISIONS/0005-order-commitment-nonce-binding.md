# ADR 0005: OrderCommitment — binding the buyer's EIP-3009 nonce to the full order and split

Status: Accepted
Date: 2026-11-06
Owner: Member 1 (contracts)

## Context

A mentor review identified that EIP-3009 authorizes a token transfer (`from`, `to`, `value`,
`validAfter`, `validBefore`, `nonce`) but does not, by itself, bind the buyer's authorization to
*which order* that payment settles. In the originally shipped `NumaRouter.payOrder`, `authNonce`
was an arbitrary caller-supplied `bytes32`, never checked against the `Order` being settled. Since
`payOrder` is permissionless and `createCampaign` is permissionless, an attacker could create their
own campaign/creator, sign their own order with a matching `gross`, and redirect a buyer's
authorized payment to themselves — the buyer never cryptographically agreed to which order
consumed their authorization. Full analysis: see the security design validation conversation
preceding this ADR (not separately filed — this ADR captures the accepted outcome).

## Decision

The buyer's EIP-3009 `nonce` (passed into `payOrder` as `authNonce`) must equal
`computeOrderCommitment(order, campaign.commissionBps, feeBps)` — a new EIP-712 digest, computed
in the router's existing domain (`"NumaRouter"`, `"1"`), over:

```
OrderCommitment(uint256 campaignId, address merchant, address creator, address buyer,
                uint256 gross, uint96 commissionBps, uint96 feeBps,
                bytes32 orderId, uint256 deadline)
```

`payOrder` recomputes this fresh from the submitted `order` plus the campaign's on-chain
`commissionBps` and the router's own immutable `feeBps`, and reverts
(`"NumaRouter: authNonce does not match order commitment"`) if the caller-supplied `authNonce`
doesn't match — checked after the merchant-signature check, before the EIP-3009 token call.

### Fields included and excluded, with reasoning

Included: `campaignId`, `merchant`, `creator`, `buyer`, `gross`, `commissionBps`, `feeBps`,
`orderId`, `deadline` — every field that determines where settled funds go or how much.
`commissionBps`/`feeBps` are included for defense-in-depth even though both are already immutable
today (no setter exists for either); inclusion protects against a hypothetical future version that
made either mutable, at zero cost today.

Excluded, deliberately: `feeRecipient` and the USDT token address — both are immutable per router
deployment and already implicitly pinned by the commitment's own domain separator
(`verifyingContract = router address`); a "router replacement" already invalidates any prior
commitment via domain separation, so there is no way to vary either without already breaking every
existing signature. `refundWindow` and the campaign's `paused`/creator-approval state are excluded
because they don't affect settlement *amounts* — they're binary gates checked live on every call,
before any token movement, and fail the whole transaction safely regardless of commitment content.

### No circular dependency

`OrderCommitment` is a function of `Order` fields plus on-chain campaign/fee terms only —
`authNonce` is never one of its own inputs. The distinct typehash (`OrderCommitment` vs. the
existing `Order` typehash) guarantees the two digests can never collide for the same field values.

## Consequences

- The backend (Member 2) must compute this exact same digest — same field order, and critically
  the same **types** (`uint96` for `commissionBps`/`feeBps`, not `uint256` — the EIP-712 typehash
  is a hash of the literal type-signature string, so a width mismatch silently produces a
  different, non-matching digest) — when constructing the buyer's EIP-3009 signing request.
- `packages/contracts/src/NumaRouter.sol` exposes `computeOrderCommitment(...)` as a `public view`
  function specifically so the backend/tests can call it directly rather than reimplementing the
  hash independently (though a reimplementation is also necessary for genuine cross-language
  verification — see the fixed test vector in `test/NumaRouter.t.sol` and
  `packages/shared/src/contracts-types.ts`).
- Does not change `refund()`/`release()` or the accepted refund-funding model
  (`docs/DECISIONS/0001-refund-funding-model.md`) in any way.
- A malicious relayer can no longer redirect settlement to a different order/campaign/creator; it
  retains only censorship power (withhold or delay submission within the signed window) — a
  liveness concern, not a fund-safety one.
- Residual trust assumption, unchanged by this fix: a compromised campaign `payoutSigner` can sign
  arbitrary orders for that campaign, but still cannot move a buyer's funds without that buyer
  separately signing the matching commitment — this requires either a second compromise or a
  deceptive frontend, which is a UX/trust-boundary issue inherent to any EIP-712 scheme, not
  something fixable at the protocol layer.
