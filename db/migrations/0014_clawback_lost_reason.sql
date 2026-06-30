-- lost_reason: sub-reason captured at the moment a case is marked LOST.
--
-- Per Poz (30 Jun 2026), the monthly categorised report Guy wants
-- needs Dead client / Dead contact / Pitched-and-missed broken out
-- separately for status='dead' cases. CFO / Lapsed / Reinstated /
-- Resold are derived from L&G warning + status; only the LOST bucket
-- needs a stored sub-reason.
--
-- Values:
--   dead_client     - claim declined, provider must cancel from outset
--                     and refund premiums, no way to save
--   dead_contact    - lost contact with client (no phone, no reply)
--   pitched_missed  - the lads pitched but couldn't save or resell
--   other           - fall-through for legacy/edge cases

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

ALTER TABLE clawback_cases
  DROP CONSTRAINT IF EXISTS clawback_cases_lost_reason_chk;

ALTER TABLE clawback_cases
  ADD CONSTRAINT clawback_cases_lost_reason_chk
  CHECK (lost_reason IS NULL
         OR lost_reason IN ('dead_client', 'dead_contact', 'pitched_missed', 'other'));
