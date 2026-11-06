# Smart contracts (`packages/contracts`) — **design only, not implemented**

Foundry, Solidity 0.8.28, OpenZeppelin (SafeERC20, ReentrancyGuard, EIP712, ECDSA, Pausable). Token address immutable.

## CampaignRegistry
- `createCampaign(payoutSigner, commissionBps ≤ 5000, endsAt, …) → id` — caller is merchant.
- `approveCreator(id, creator)`, `revokeCreator(id, creator)`, `pause(id)` — merchant only.
- Views used by the router: campaign status/active (not paused, not ended), merchant, payoutSigner, commissionBps, `isApproved(id, creator)`.
- Mutability (proposal): `commissionBps` and `endsAt` immutable after creation (approved terms can't change under creators); `payoutSigner` and pause state mutable by merchant.
- Events: CampaignCreated, CreatorApproved, CreatorRevoked, CampaignPaused.

## NumaRouter
`payOrder(Order, merchantSig, buyer, validAfter, validBefore, v, r, s)`:
1. deadline ok; orderId unused; campaign active; creator approved; buyer ∉ {creator, merchant}.
2. recover signer from EIP-712 `Order` == campaign payoutSigner.
3. `usdt.receiveWithAuthorization(buyer, this, amount, validAfter, validBefore, keccak(digest, creator), v, r, s)`.
4. split (below), pay merchant net and protocol fee, hold commission, record order, emit `OrderSettled`.
`release(orderId)` — anyone, after refund window; pays remaining held commission; once only; `CommissionReleased`.
`refund(orderId, amount)` — see ADR 0001; `OrderRefunded`.

Split: integer, round down; `merchantNet = gross − commission − fee`; feeBps ≤ 100.

## Invariants (to fuzz)
Σ payouts = gross; held ≤ commission; held + released + clawed = commission; an order settles/releases at most once; refunds ≤ gross; router USDT balance ≥ Σ held (+ refundable escrow if ADR option A).

## Trust assumptions
Merchant payout signer is trusted to sign legitimate orders (merchant collusion is out of scope); USDT proxy admin could change the token; the router has no admin withdrawal.
