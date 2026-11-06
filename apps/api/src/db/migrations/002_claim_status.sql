-- Relay claims now carry an outcome so uncertain/timed-out transactions can be reconciled from chain.
ALTER TABLE relay_claims ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'claimed';
ALTER TABLE relay_claims ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
-- Existing rows that already have a tx hash were sent.
UPDATE relay_claims SET status = 'sent', sent_at = created_at WHERE tx_hash IS NOT NULL AND status = 'claimed';
CREATE INDEX IF NOT EXISTS relay_claims_sent_idx ON relay_claims (status, sent_at);
