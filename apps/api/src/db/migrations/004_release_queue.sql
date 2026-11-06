-- Orders whose held commission still needs a release() call after the refund window. Filled by the indexer from OrderSettled.
CREATE TABLE IF NOT EXISTS release_queue (
  order_id   TEXT PRIMARY KEY,
  paid_at    BIGINT NOT NULL,          -- block timestamp of settlement (unix seconds)
  done       BOOLEAN NOT NULL DEFAULT false,
  tx_hash    TEXT,                     -- release tx in flight, if any
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS release_queue_due_idx ON release_queue (done, paid_at);
