# Demo plan (3 minutes) — **a plan; nothing here has been demonstrated yet**
Real transactions only. The refund window is shortened to 60 s and disclosed on screen. The buyer wallet holds zero WBT.

| Time | Beat |
|---|---|
| 0:00 | Hook: bots fake clicks, honest creators can't be told apart |
| 0:15 | Merchant creates a campaign (Whitechain tx + Arkiv entity) |
| 0:40 | Creator profile and offer, merchant approval (`approveCreator` tx, Arkiv offer + decision). *Optional:* each side's negotiation agent settles the rate over Arkiv first (`AGENTS.md`) |
| 1:10 | `pnpm --filter @numa/api demo:fake-clicks -- --code <link code> --n 500 --creator <addr> --campaign <id>` sends 500 real HTTP clicks, then `/links/:code/stats` shows 500 clicks next to 0 verified sales and 0 commission (no fabricated transactions; needs the stack running with Arkiv configured to show the verified side) |
| 1:30 | Real sale from a phone through the relayer: show the tx (merchant net, held commission, fee) |
| 2:00 | Partial refund with clawback, then release (`OrderRefunded`, `CommissionReleased`). **Drop this beat if the refund path isn't proven** |
| 2:30 | Creator card with Arkiv history verified against `OrderSettled` |
| 2:50 | Ledger close |

## Preconditions
- [ ] Contracts deployed and verified; addresses in `packages/shared/src/addresses.ts` and `.env`
- [ ] Relayer wallet funded with WBT; Arkiv writer funded with tGLM
- [ ] `seed:demo` run so discovery screens are populated (its `[DEMO]` rows are labelled, and unverified on-chain)
- [x] Checkout component built (`@numa/sdk-react`, `apps/demo-shop`); [ ] run it against the deployed stack with a real wallet that holds test USDT and zero WBT
- [ ] At least one rehearsed end-to-end run on the real chain
