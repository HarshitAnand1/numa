# ADR 0001 — Refund funding model
**Status: Proposed (needs Member 1 + team decision).**
Problem: merchant net is paid instantly at settlement, so a later refund has no funds in the router. The router must not promise money it doesn't hold.

Refund math (both options): refunding `X` of `gross` returns `X` to the buyer and claws back `X·commissionBps/10000` of held commission to the merchant; the protocol fee is retained (proposal). Example: gross 100, commission 10, fee 0.5, refund 50 → buyer +50, merchant −50 +5 clawback, creator keeps 5, fee 0.5.

**A. Hold the refundable portion in the router for the window** (recommended): merchant net is released after the window (or on merchant-approved early release). Pro: refunds always funded; simple; demo can't fail on liquidity. Con: contradicts "merchant paid immediately"; merchant waits.
**B. Merchant-funded pull**: merchant pre-approves USDT to the router; `refund` pulls `X` from the merchant. Pro: immediate merchant payout. Con: refund reverts if merchant lacks balance/allowance; needs a defined failure path.
**C. Merchant refunds off-router, router only claws back on proof**: weakest guarantees; rejected.
