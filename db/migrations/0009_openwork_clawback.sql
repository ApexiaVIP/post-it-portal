-- Pauline reconciles the L&G EBAH clawback figure against the daily
-- Openwork clawback notification, which can differ (provider amount vs
-- what OW actually deducts). She owns the "actual" Openwork value and
-- needs an editable column to override the L&G figure per case.
--
-- Reports + summary tiles use COALESCE(openwork_clawback_due,
-- clawback_due) so the OW number wins where set, falling back to the
-- provider figure otherwise. net_at_risk is recomputed from the
-- COALESCEd value in a generated column update below.

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS openwork_clawback_due NUMERIC(12,2);

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS openwork_cb_updated_by TEXT;

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS openwork_cb_updated_at TIMESTAMPTZ;

-- net_at_risk was a generated column based on clawback_due - saved_amount.
-- Drop and re-create using COALESCE so the OW value wins when present.
ALTER TABLE clawback_cases
  DROP COLUMN IF EXISTS net_at_risk;

ALTER TABLE clawback_cases
  ADD COLUMN net_at_risk NUMERIC(12,2) GENERATED ALWAYS AS (
    GREATEST(COALESCE(openwork_clawback_due, clawback_due) - saved_amount, 0)
  ) STORED;

CREATE INDEX IF NOT EXISTS clawback_cases_openwork_cb_idx
  ON clawback_cases(openwork_clawback_due)
  WHERE openwork_clawback_due IS NOT NULL;
