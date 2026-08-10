-- Adviser cancelled-deals workspace (Poz, 6 Aug 2026).
--
-- Advisers work their own cancelled deals: record calls, mark the
-- outcome (Resold or P&M), capture replacement details + new commission,
-- and a senior admin manually enters the potential clawback saved.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS resold_outcome        TEXT CHECK (resold_outcome IN ('resold','pm')),
  ADD COLUMN IF NOT EXISTS resold_details        TEXT,             -- replacement / policy details
  ADD COLUMN IF NOT EXISTS resold_new_commission NUMERIC(12,2),    -- new commission sold
  ADD COLUMN IF NOT EXISTS clawback_saved        NUMERIC(12,2),    -- manual entry, senior admin only
  ADD COLUMN IF NOT EXISTS resold_notes          TEXT,
  ADD COLUMN IF NOT EXISTS resold_recorded_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resold_recorded_by    TEXT;

-- Call log: one row per call an adviser makes on a case. Outcomes are a
-- code-side list (extendable on request); stored as free text so adding
-- options never needs a migration.
CREATE TABLE IF NOT EXISTS deal_calls (
  id         SERIAL PRIMARY KEY,
  deal_id    INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  called_on  DATE NOT NULL,
  outcome    TEXT NOT NULL,
  note       TEXT,
  actor      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_calls_deal ON deal_calls(deal_id);
