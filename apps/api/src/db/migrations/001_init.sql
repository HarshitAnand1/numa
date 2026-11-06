-- Operational data only. Money and marketplace state live on-chain / in Arkiv.
CREATE TABLE IF NOT EXISTS relay_claims (
  order_id   TEXT PRIMARY KEY,
  buyer      TEXT NOT NULL,
  tx_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS relay_spend (
  day TEXT PRIMARY KEY,
  wei NUMERIC(78,0) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS relay_address_counts (
  day     TEXT NOT NULL,
  address TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, address)
);
CREATE TABLE IF NOT EXISTS indexer_cursor (
  id    TEXT PRIMARY KEY,
  block NUMERIC(78,0) NOT NULL
);
