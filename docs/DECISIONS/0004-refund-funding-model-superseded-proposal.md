# ADR 0004 (superseded draft): Refund funding model — earlier proposal

Status: Superseded by `docs/DECISIONS/0001-refund-funding-model.md` (Accepted)
Originally drafted as a second, independent "ADR 0001" alongside the backend/Arkiv work on
`feat/backend-relayer`; renumbered to 0004 (next available slot after 0001–0003) during the
`feat/contracts` ↔ `main` merge to resolve the filename collision. Preserved here for its
reasoning and the alternatives it considered, not as an active decision.

---

**Status: Proposed (needs Member 1 + team decision).**

Problem: merchant net is paid instantly at settlement, so a later refund has no funds in the
router. The router must not promise money it doesn't hold.

Refund math (both options): refunding `X` of `gross` returns `X` to the buyer and claws back
`X·commissionBps/10000` of held commission to the merchant; the protocol fee is retained
(proposal). Example: gross 100, commission 10, fee 0.5, refund 50 → buyer +50, merchant −50 +5
clawback, creator keeps 5, fee 0.5.

**A. Hold the refundable portion in the router for the window** (recommended): merchant net is
released after the window (or on merchant-approved early release). Pro: refunds always funded;
simple; demo can't fail on liquidity. Con: contradicts "merchant paid immediately"; merchant
waits.

**B. Merchant-funded pull**: merchant pre-approves USDT to the router; `refund` pulls `X` from the
merchant. Pro: immediate merchant payout. Con: refund reverts if merchant lacks balance/allowance;
needs a defined failure path.

**C. Merchant refunds off-router, router only claws back on proof**: weakest guarantees;
rejected.

---

## Note on resolution

The accepted ADR (0001) independently reached option B (merchant-funded pull), matching this
draft's own preference inversion in practice — the implemented contract uses option B, not the
"recommended" option A above. The implemented version additionally corrects a refund-accounting
edge case not addressed in this draft's simplified math (see ADR 0001, "Why divide by
`refundableBase` and not `gross`") and specifies an exact clawback/pull formula, both missing
here.
