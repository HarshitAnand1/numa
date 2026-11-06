# ADR 0008 — Negotiation agents coordinate on Arkiv; no contract changes
**Status: Proposed (Member 2). Needs team review before the pitch mentions it.**

**Context.** Offers, decisions and invites already live in Arkiv as wallet-owned entities. A creator and a merchant currently settle terms by hand. We want optional AI agents that negotiate the commission rate on each party's behalf.

**Facts that constrain the design (checked against the contracts).**
- Commission is **per campaign** (`CampaignRegistry.createCampaign(payoutSigner, commissionBps, endsAt)`). `approveCreator(campaignId, creator)` only whitelists a creator; it does **not** carry a rate. A rate negotiated per creator therefore cannot be enforced on-chain without a contract change.
- `approveCreator` must be called by the campaign's merchant, and a merchant cannot approve itself as a creator.
- Arkiv ownership is the creating wallet. Anyone can write any entity.

**Decision.**
1. Agents exchange `numa.negotiation` messages on Arkiv. No new contracts.
2. A principal (creator or merchant) delegates to an agent wallet by publishing a `numa.agent` binding owned by the principal. Readers trust an agent's message only if a live binding from the right principal names that agent wallet. Deleting the binding revokes it.
3. A rules engine decides every action. It enforces the principal's private guardrails (floor/ceiling, auto-accept threshold, max rounds, concession step). An LLM, when configured, only drafts the human-readable note; it never chooses the number and a failure or refusal falls back to a template.
4. Guardrails are private, so they live in Postgres, never on Arkiv.
5. A reached deal is **not** self-executing. The agent never holds the merchant's key. It produces a deal ticket, and the merchant signs the on-chain step: reuse an existing campaign whose `commissionBps` equals the agreed rate (`approveCreator`), or create a dedicated campaign at that rate and approve the creator on it. The merchant's wallet makes both calls.

**Consequences.**
- The negotiated rate becomes enforceable only through the campaign it is attached to (the rate is also bound into each order's `OrderCommitment`).
- A per-creator rate in one campaign would need a contract change; revisit after the hackathon.
- Agent wallets are hot keys that can only write Arkiv entities. They cannot move funds or call the router or registry.
- Prompt injection: counterpart `note` text is untrusted. It is never fed to the decision engine, and is passed to the LLM only as quoted data.
