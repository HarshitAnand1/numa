# ADR 0001: Refund Funding Model

Status: Accepted
Date: 2026-11-06
Owner: Member 1 (contracts)

## Context

`payOrder` pays the merchant's net proceeds immediately (brief requirement — merchants must not
wait for a refund window to get paid). This means the router does not hold the merchant's net by
the time a refund is requested, only the creator's held commission. A refund must come from
somewhere other than "funds already sitting in the router for this order."

Two options were considered:

1. **Escrow the merchant's net** until the refund window closes, then release it. Guarantees
   refund liquidity but contradicts the "merchant paid immediately" requirement and hurts the
   core pitch (merchants get paid for real sales, not after a waiting period).
2. **Merchant-approved USDT pull.** Merchant keeps a standing `USDT.approve(NumaRouter, allowance)`
   allowance. Refunds pull the shortfall directly from the merchant's wallet.

## Decision

Use option 2: merchant-approved pull, combined with clawback of any still-held commission.

### Mechanics

For an order with `gross`, `commissionBps`, `feeBps`:
- `commission = gross * commissionBps / 10000`
- `fee = gross * feeBps / 10000`
- `merchantNet = gross - commission - fee`

On `payOrder`: merchant receives `merchantNet` immediately, router holds `commission` as
`heldCommission[orderId]`, `fee` is sent to the protocol fee recipient immediately.

Because the fee is paid out immediately and is never refunded, the maximum amount that can ever
be refunded across all calls for an order is `gross - fee` (= `merchantNet + commission`), not
the full `gross`. `refund()` enforces `refundedGross + refundAmount <= gross - fee` and reverts
above that cap — a full-gross refund is not possible by construction, since the fee portion was
already paid out and is not reclaimed from the fee recipient.

On `refund(orderId, refundAmount)` (merchant-only, `refundedGross + refundAmount <= refundableBase`
where `refundableBase = gross - fee`, only before `release`):
- `commissionClawback = commission * refundAmount / refundableBase` (proportional to the
  refundable base, **not** gross — capped at `heldCommission[orderId]`)
- The clawback is paid out of `heldCommission[orderId]` toward the refund (reduces what the
  creator can later claim at `release`).
- The remaining `refundAmount - commissionClawback` is pulled from the merchant via
  `SafeERC20.safeTransferFrom(merchant, buyer, ...)`, requiring the merchant to hold a sufficient
  `USDT.approve(NumaRouter, ...)` allowance.
- The protocol fee is **never refunded** — it is the cost of settlement, already paid out.
- `heldCommission[orderId] -= commissionClawback`; `refundedGross[orderId] += refundAmount`.

**Why divide by `refundableBase` and not `gross`:** dividing by `gross` (the naive reading of the
brief's illustrative example) under-claws-back commission relative to the fee's share, so a
refund approaching the maximum refundable amount requires pulling slightly *more* from the
merchant than `merchantNet` — a shortfall of `fee * commission / gross` that the merchant never
received and the contract doesn't hold. Dividing by `refundableBase = gross - fee` instead keeps
the invariant exact at every refund size: a refund of the full `refundableBase` claws back
exactly the full `heldCommission` and pulls exactly `merchantNet` from the merchant, never more.

Worked example (adapted from the brief's gross 100 / commission 10 (10%) / fee 0.5 (0.5%) /
merchant net 89.5 case): `refundableBase = 99.5`. Refund 50 before release → clawback =
`10 * 50 / 99.5 ≈ 5.025` (paid from held commission to buyer), merchant pull = `50 - 5.025 ≈
44.975` (from merchant's allowance to buyer). Buyer receives 50 total. This differs slightly from
the brief's simplified "clawback exactly 5 / pull exactly 45" illustration because the brief's
numbers don't account for the fee's interaction with the clawback at the refund boundary — the
`refundableBase` denominator is the correction needed to keep the model solvent at the cap. Max
refundable for this order is 99.5 (`gross - fee`), not the full 100.

### Consequences

- Merchants must maintain a USDT allowance to `NumaRouter` for the campaign's expected refund
  exposure. The frontend/merchant onboarding flow (Member 3) must prompt for this approval
  alongside order signing setup; documented as an integration requirement in `docs/SDK.md`
  (Member 3/2 owns that doc).
- If the merchant's allowance or balance is insufficient at refund time, `refund()` reverts
  (`SafeERC20` propagates the ERC-20 failure). The relayer/backend (Member 2) should treat this as
  an operational failure, not a silent no-op, and surface it to the merchant.
- This does not solve merchant insolvency — a merchant that revokes/exhausts their allowance can
  block refunds. Documented as a known limitation, not a security bug: the buyer's USDT payment
  already settled on-chain: the merchant's refund posture is unrelated to settlement integrity.
- A full refund after the full held commission has already clawed back to zero still succeeds as
  long as the merchant's allowance covers the remainder; no on-chain enforcement requires
  merchants to keep a specific allowance size, so this is a documented operational requirement,
  not a protocol-enforced one.
