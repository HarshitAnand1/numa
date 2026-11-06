-- Private negotiation-agent guardrails. Deliberately NOT on Arkiv: the counterparty must not see a floor or ceiling.
CREATE TABLE IF NOT EXISTS agent_policies (
  principal       TEXT NOT NULL,            -- lowercase 0x address of the creator/merchant who owns the policy
  role            TEXT NOT NULL CHECK (role IN ('creator','merchant')),
  enabled         BOOLEAN NOT NULL DEFAULT false,
  limit_bps       INTEGER NOT NULL,         -- creator floor / merchant ceiling
  opening_bps     INTEGER NOT NULL,
  auto_accept_bps INTEGER NOT NULL,
  step_bps        INTEGER NOT NULL,
  max_rounds      INTEGER NOT NULL,
  categories      TEXT[] NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (principal, role)
);
