# Arkiv schema

Source of truth: [`packages/arkiv/src/schemas.ts`](../packages/arkiv/src/schemas.ts) (SDK `@arkiv-network/sdk` 1.0.1, Rabdi chain 7794095). Only columns marked **indexed** are filterable. The owner of every entity is the wallet that created it (`$owner`, queried with `.ownedBy`). Anyone can write any entity, so **readers verify ownership** before trusting a row.

| Entity | Owner (who can edit) | Indexed (queried) | Stored, not queried | Expires |
|---|---|---|---|---|
| `numa.campaign` | merchant wallet | campaignId, status, category, commissionBps, endsAt, region | name, description | campaign `endsAt` + 7 days (max 182 days) |
| `numa.offer` | creator wallet | campaignId, channel, askBps | audience, expectedReach | 72 hours |
| `numa.decision` | merchant wallet | offerKey, campaignId, result | approveTx | campaign end |
| `numa.link` | creator wallet | code, campaignId | none | creator-chosen days |
| `numa.conversion` | Numa writer wallet | creator, merchant, campaignId, status, paidAt, txHash, orderId | gross, commission | 90 days |
| `numa.profile` | creator wallet | niche, channel, minAskBps, open | displayName, bio, niches, handle | 90 days, renewable (`renewProfile`) |
| `numa.invite` | merchant wallet | campaignId, creator | offeredBps, message | 48 hours |
| `numa.endorsement` | merchant wallet | creator, campaignId, orderId, rating | txHash, note | 180 days |

## Trust rules (enforced in `apps/api`)
- Campaign/invite is trusted only if the Arkiv owner equals `CampaignRegistry.getCampaign(id).merchant` on-chain. If the registry is unavailable the API reports `null` (unknown), never `true`.
- A conversion is trusted only if it is owned by the configured writer wallet **and** matches an `OrderSettled` event for its `txHash`.
- An endorsement counts only if its merchant owns it and the referenced order settled from that merchant.
- Profiles are self-asserted; verified numbers come from conversions/endorsements, never from the profile.

## Wallets that wrote our entities (Rabdi)
| Role | Address |
|---|---|
| Numa writer (conversions; funds demo wallets) | `0x53FFc438d1389087e0159F024C2C85cC08eA32B3` |
| Demo merchants (campaigns 7001-7004) | `0xa585B48e79Ff993B83a627254DaFaC907FE427a8`, `0x5B738aC6EF8E612824C7A868aA01b28Fc725608b`, `0x5Eeac97197CD01B77377FE38C71EDD8936b2BF32` |
| Demo creators (profiles + offers) | `0x480E6D411446fe17D594a6C7eD78f02fA761DDD1`, `0xfC0a11f9f947455BfD03b2f527F6C0c538206564`, `0x5a1AD7c745bc53bc6bFd59a040AB9d9254E90aa1`, `0x6d6645DDB3E82a10885A95e184Bbe8160A726a0D` |

Demo entities are prefixed `[DEMO]`, were created by `pnpm --filter @numa/arkiv seed:demo`, and do not correspond to on-chain campaigns or real sales. Explorer: https://rabdi.explorer.arkiv.network
