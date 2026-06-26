-- Per Pauline (June 2026): the L&G EBAH gives a forecast clawback amount,
-- and the Openwork notification gives the recharged value, but at the
-- FINAL decision (when the clawback actually settles) the amount can vary
-- from both. She wants to capture that final actual figure separately so
-- the audit trail keeps the L&G forecast and OW reconciliation, while
-- reports reflect what was really lost / clawed back.
--
-- Priority for any "effective CB" reading:
--   final_clawback_due  (when set, canonical)
--   openwork_clawback_due  (when set, OW reconciled)
--   clawback_due  (L&G forecast from EBAH)
--
-- net_at_risk gets regenerated to use the same priority chain so the
-- forecast / dashboard / reports stay in sync the moment Pauline records
-- a final figure.

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS final_clawback_due NUMERIC(12,2);

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS final_cb_updated_by TEXT;

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS final_cb_updated_at TIMESTAMPTZ;

-- Drop the existing generated net_at_risk and re-create with the new
-- priority chain.
ALTER TABLE clawback_cases
  DROP COLUMN IF EXISTS net_at_risk;

ALTER TABLE clawback_cases
  ADD COLUMN net_at_risk NUMERIC(12,2) GENERATED ALWAYS AS (
    GREATEST(
      COALESCE(final_clawback_due, openwork_clawback_due, clawback_due) - saved_amount,
      0
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS clawback_cases_final_cb_idx
  ON clawback_cases(final_clawback_due)
  WHERE final_clawback_due IS NOT NULL;
