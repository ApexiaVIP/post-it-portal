-- Poz 1 Jul 2026: two new concepts.
--
-- 1) Redraw status
--    L&G sometimes claws back the original commission, the client sets
--    up a revised policy, and L&G pays commission on the new terms.
--    Poz manually flags these when she spots them (L&G doesn't tag
--    them on the EBAH). She wants to record the off commission and the
--    on commission separately so the system can show Net position.
--
-- 2) Historic Old OW bucket
--    Cases flagged source='old_ow' rarely actually claw back through the
--    new OW bank statement; keeping them in the current at-risk figures
--    inflates the number Guy sees. We split them into a separate
--    "Historic Old OW exposure" bucket. When one DOES appear on the OW
--    bank statement, Poz sets ow_actualised_at and the case moves back
--    into the current-period at-risk numbers.

-- Extend the status enum to include 'redraw'.
ALTER TABLE clawback_cases DROP CONSTRAINT IF EXISTS clawback_cases_status_check;
ALTER TABLE clawback_cases
  ADD CONSTRAINT clawback_cases_status_check
  CHECK (status IN (
    'open',
    'saved',
    'resold',
    'dead',
    'reinstated',
    'redraw',
    'closed'
  ));

-- Redraw amounts: off commission (what L&G took back) + on commission
-- (what L&G paid for the revised terms). Net = on - off. Positive =
-- profit on the swap, negative = residual loss.
ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS redraw_off_amount NUMERIC(12,2) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS redraw_on_amount  NUMERIC(12,2) DEFAULT 0 NOT NULL;

-- Historic OW override. NULL = still historic (not counted in current
-- at-risk). A timestamp = Poz has flagged it as actually clawed back on
-- the OW bank statement, so it moves back into the current-period
-- reporting.
ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS ow_actualised_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ow_actualised_by   TEXT;
