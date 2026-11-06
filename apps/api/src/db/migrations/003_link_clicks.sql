-- Off-chain operational analytics only. Clicks never create commission; settled USDT payments do.
CREATE TABLE IF NOT EXISTS link_clicks (
  id         BIGSERIAL PRIMARY KEY,
  code       TEXT NOT NULL,
  visitor    TEXT NOT NULL,              -- truncated salted hash of ip+user-agent, never the raw ip
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_clicks_code_idx ON link_clicks (code, created_at);
