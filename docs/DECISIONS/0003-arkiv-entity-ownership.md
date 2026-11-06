# ADR 0003 — Arkiv for coordination, chain for money
**Status: Accepted.** Arkiv holds wallet-owned discovery/attribution data and holds no funds or secrets. Anyone can write any entity, so readers must verify the owning wallet (links → creator, decisions → merchant, conversions → Numa writer) and, for conversions, the matching `OrderSettled` event. Postgres is for operational data only.
