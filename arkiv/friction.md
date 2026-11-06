# Arkiv feedback (friction we actually hit)

Each item is something we ran into building `packages/arkiv`. Expectation, what happened, and how to reproduce.

1. **Docs differ across SDK versions.** *Expected*: one current API. *Happened*: examples for 0.4-1.0 use different shapes, so we had to read the installed 1.0.1 package types/README instead. *Repro*: compare the docs snippets against `node_modules/@arkiv-network/sdk` 1.0.1.
2. **Writes need hand-picked nonce, gas and gasPrice on Rabdi.** *Expected*: the SDK estimates. *Happened*: we had to set an explicit nonce, a gas floor of 1,000,000 and gasPrice, and serialize writes ourselves (`packages/arkiv/src/safeWriter.ts`) to avoid nonce collisions. Suggest: a safe default writer, or a documented minimum gas. *Repro*: send several quick writes from one wallet without a serialized queue.
3. **Queries need at least one filter, and only `.indexed()` columns are filterable.** We learned this by hitting it, and it shapes the whole schema (a column you forget to index cannot be searched later without republishing). Suggest: a schema-time warning for unindexed columns you query, and a docs page listing which operators each column type supports.
4. **Unauthenticated reads are heavily rate limited.** *Happened*: with no access key, the first discovery query hung about 60 seconds, then later ones returned in about 1 second. We now bound requests with a 504 timeout. Suggest: a faster fail with a clear 429. *Repro*: query `listCampaigns` with an empty access key from a cold start.
5. **No server-side way to prove who wrote an entity beyond `$owner`.** Anyone can write any entity type, so each app must re-verify. We would like an optional per-schema "writer allowlist" or signed entity, so spam cannot appear in a shared schema. (Feature request.)
6. **182-day maximum lifetime.** A campaign longer than ~175 days cannot be represented (`expiry.ts` throws). Fine, but we'd like to see it in the docs next to `ExpirationTime`.
7. **Feature request: aggregate queries.** We rank campaigns by number of live offers and creators by conversions by fetching rows and counting client-side. A `count`/`group by` would remove that.

Not (yet) observed by us: entity expiry actually firing; behaviour of 100-row pages; large payloads.
