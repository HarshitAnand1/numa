# Documentation index

**Start with [`PROJECT_STATUS.md`](PROJECT_STATUS.md)**: what is built, what is verified, what is blocked. Docs for unbuilt parts say so.

| Doc | Read it for |
|---|---|
| [`DESIGN.md`](DESIGN.md) | Product, requirements, and how the pieces fit |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Mermaid diagrams: flows for checkout, relaying, splitting, refunds, release, Arkiv ownership, discovery, agents |
| [`SMART_CONTRACTS.md`](SMART_CONTRACTS.md) | `CampaignRegistry` / `NumaRouter` behaviour and tests |
| [`DEPLOYMENT_CHECKLIST.md`](DEPLOYMENT_CHECKLIST.md) | Step-by-step first deploy and first transaction (not yet executed) |
| [`WHITECHAIN.md`](WHITECHAIN.md) | Network facts and the verified USDT / EIP-3009 support |
| [`RELAYER.md`](RELAYER.md) | Relayer guards, reconciliation, release keeper |
| [`API.md`](API.md) | HTTP endpoints, error codes, reputation formula |
| [`ARKIV.md`](ARKIV.md) | Arkiv schemas, trust rules, safe writer, what was verified live |
| [`AGENTS.md`](AGENTS.md) | Negotiation agents: design, trust, what's verified |
| [`SDK.md`](SDK.md) | Merchant SDK (`sdk-server` built, `sdk-react` planned) |
| [`SECURITY.md`](SECURITY.md) | Threat model and honest limitations |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Setup, scripts, database, Docker, CI |
| [`HOSTING.md`](HOSTING.md) | Deploying the API and web apps on Render's free tier, with the caveats |
| [`DEMO.md`](DEMO.md) | The 3-minute demo plan and its preconditions |
| [`FIGMA_PROMPT.md`](FIGMA_PROMPT.md) | The prompt behind the frontend design |
| [`REPOSITORY_AUDIT.md`](REPOSITORY_AUDIT.md) | Day-one snapshot of the repo (historical) |
| [`DECISIONS/`](DECISIONS) | ADRs: 0001 refund funding, 0002 no oracle/Stripe, 0003 Arkiv ownership, 0004 superseded refund draft, 0005 `OrderCommitment`, 0006 pre-deployment hardening, 0007 web as a Vite SPA, 0008 negotiation agents (Proposed) |

Hackathon submission files for the Arkiv track are in [`../arkiv/`](../arkiv).
