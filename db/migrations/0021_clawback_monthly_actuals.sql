-- CB by month (Poz, 24 Sep 2026): Guy's headline MI is forecast CB vs
-- actual CB taken, month by month. Actual CB is what Openwork really
-- debited, which differs from the L&G EBAH forecast in both amount and
-- timing, so it can't be derived from case data. Poz downloads it from
-- the Openwork portal and types it in here.
--
--   total_amount   actual CB Openwork took that month (all business)
--   old_ow_amount  of which Old Openwork; New OW = total - old. NULL
--                  until Poz enters the split for that month.

CREATE TABLE IF NOT EXISTS clawback_monthly_actuals (
  year           INT            NOT NULL,
  month          INT            NOT NULL CHECK (month BETWEEN 1 AND 12),
  total_amount   NUMERIC(12,2)  NOT NULL,
  old_ow_amount  NUMERIC(12,2),
  note           TEXT,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month)
);
