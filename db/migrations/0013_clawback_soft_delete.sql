-- Soft delete for clawback cases.
--
-- Pauline asked for an admin Delete button so she can wipe junk rows
-- (e.g. "Increasing cover" warnings that never accrue a CB). We keep
-- the row in place but flag deleted_at so it disappears from every
-- read view -- dashboard, reports, forecast, summary, notify-unnotified
-- -- while preserving the full history for audit. Reversible by setting
-- deleted_at = NULL.

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS clawback_cases_deleted_at_idx
  ON clawback_cases(deleted_at)
  WHERE deleted_at IS NOT NULL;
