-- The Fact Find sheet completed online (Jimmy, 24 Nov 2026), so the advice
-- check never depends on reading handwriting. One form per client, saved as
-- the seller goes, checked as often as needed. First names and ages only.
CREATE TABLE IF NOT EXISTS fact_finds (
  id              SERIAL PRIMARY KEY,
  adviser_id      INT         REFERENCES advisers(id),
  created_by      TEXT        NOT NULL,
  client_label    TEXT        NOT NULL,
  case_type       TEXT        NOT NULL CHECK (case_type IN ('one_call', 'two_call')),
  fact_find_date  DATE        NOT NULL,
  -- The issue date of the sheet it was started on (src/lib/factfind).
  sheet_version   TEXT        NOT NULL,
  data            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Goes up by one with each save, so two open copies can't overwrite each other.
  rev             INT         NOT NULL DEFAULT 1,
  presented       BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Answers cleared once the agreed keeping time is up.
  purged_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS fact_finds_adviser_idx ON fact_finds (adviser_id, updated_at DESC);

ALTER TABLE advice_checks ADD COLUMN IF NOT EXISTS fact_find_id INT REFERENCES fact_finds(id);
CREATE INDEX IF NOT EXISTS advice_checks_fact_find_idx ON advice_checks (fact_find_id);

-- Gate 5: the red lines of a call report, picked out from its own results.
ALTER TABLE qa_runs DROP CONSTRAINT IF EXISTS qa_runs_gate_check;
ALTER TABLE qa_runs ADD CONSTRAINT qa_runs_gate_check CHECK (gate IN (1, 2, 3, 4, 5));
