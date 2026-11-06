# Negotiation agents (design)
Status: **backend built and tested; not yet run against a deployed registry or with a real LLM key; no UI.** See `docs/DECISIONS/0008-negotiation-agents.md`. Anything not marked verified below is not verified.

## Goal
A creator and a merchant can each switch on an agent that negotiates the commission rate over Arkiv while they are away, inside limits only the owner knows. The deal still ends in a normal on-chain approval and a real USDT sale.

## Components
| Piece | Where | Notes |
|---|---|---|
| `numa.agent` entity | Arkiv, owner = principal | Binds an agent wallet to a role. Revocable (delete). Expires in 30 days. |
| `numa.negotiation` entity | Arkiv, owner = agent or principal wallet | One message per round: propose / counter / accept / reject. Expires 72h with the offer. |
| Policy | Postgres (`agent_policies`), private | role, floor/ceiling, opening, auto-accept, max rounds, step, categories. |
| Decision engine | `apps/api/src/agents/engine.ts` | Pure function. Guardrails are enforced here, not in the model. |
| Note drafter | `apps/api/src/agents/llm.ts` | Optional Claude call, template fallback. Output is text only. |
| Runner | `apps/api/src/agents/runner.ts` | Polls Arkiv, verifies, decides, publishes. Idempotent per (thread, seq). |
| Deal ticket | `GET /agents/deals` | What the merchant must sign on-chain. |

## Negotiation flow
```
creator offer (askBps, 72h) ──► merchant agent: auto-accept if ask <= autoAccept, else propose(openingBps)
creator agent: accept if proposal >= floor, else counter(lower of its last ask - step, never below floor)
merchant agent: accept if counter <= min(ceiling, campaign.commissionBps), else counter(its last + step, capped)
... until accept, reject, or maxRounds ──► deal ticket
```
Hard rules (engine): never go outside the owner's floor/ceiling; never exceed the campaign's own `commissionBps`; stop at `maxRounds`; one message per (thread, seq); ignore any message that fails verification.

## Verification of a thread
1. The offer's `$owner` is the creator principal.
2. The merchant principal is `CampaignRegistry.getCampaign(campaignId).merchant` (reported as unverified if no registry is configured, never silently true).
3. A message counts only if its `$owner` is the principal, or an agent wallet with a live `numa.agent` binding owned by that principal for that role.

## From deal to money
The rate lives on the campaign, not on the creator (ADR 0008). The ticket offers two merchant-signed paths: (a) an existing campaign with the same `commissionBps` → `approveCreator(campaignId, creator)`; (b) `createCampaign(payoutSigner, agreedBps, endsAt)` then `approveCreator(newId, creator)`. The agent never signs either.

## Security
Agent wallets hold only tGLM for Arkiv writes. Guardrails are private. Counterparty notes are untrusted text and never reach the decision engine. The LLM can be absent or refuse without changing outcomes.

## Verified so far
- Engine, policy validation, signed policy auth, thread verification and the runner: unit/integration tests against an in-memory Arkiv ledger (`apps/api/tests/agents.test.ts`). Includes spoofed-message and unconfirmed-merchant cases and a convergence check (overlapping ranges always end in a deal inside both limits; non-overlapping ranges end in a rejection).
- `numa.agent` / `numa.negotiation` round trip on **live Rabdi**: `pnpm --filter @numa/arkiv live:agents` (4/4): binding visible only under its owner, ordered thread read-back, forged messages fail authorization. Entities were deleted afterwards.
- Run the runner with `AGENT_WALLET_PRIVATE_KEY` set (plus `CAMPAIGN_REGISTRY_ADDRESS`, Arkiv writer/access key). Poll interval defaults to 15 s so Arkiv indexing (about 0.4 s observed) finishes before the next read; an Arkiv lag longer than the interval could produce a duplicate round, which the engine ignores.

## Not built / not verified
Not verified: the Claude note path against the real API (no key was available; the tests use a fake client), anything against a deployed `CampaignRegistry`, entity expiry. The model is optional and only writes the note sentence. Not covered: collusion, spam threads (we ignore unverified messages but they still cost readers a query), multi-campaign bundles, a UI (needs an "agent activity" screen from Member 3).
