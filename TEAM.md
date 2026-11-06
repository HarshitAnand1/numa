# Team

numa is built by three human developers. (AI assistance is a tool, not a contributor.)

| Member | Name | Workstream | Main files |
|---|---|---|---|
| 1 | _TBD_ | Smart contracts and Whitechain deployment | `packages/contracts` |
| 2 | `HarshitAnand1` (GitHub) | Backend, relayer, Arkiv, negotiation agents | `apps/api`, `packages/arkiv`, `packages/sdk-server` |
| 3 | _TBD_ | Frontend and product | `apps/web`, `apps/demo-shop`, `packages/sdk-react` |

## Handoffs
- 1 → 2: contract ABIs and deployed addresses (`packages/shared`), and the `OrderSettled` / `OrderRefunded` / `CommissionReleased` events. **Waiting on the first Whitechain Sepolia deployment.**
- 2 → 3: HTTP contracts (`docs/API.md`), the Arkiv module (`packages/arkiv`), the order and relay flow (`docs/SDK.md`).
- All: architecture, security review, end-to-end testing, demo.
