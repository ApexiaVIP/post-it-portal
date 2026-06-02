-- Adds 'clawback' to the allowed values of deals.status.
-- Clawback is for deals that were Paid and have now had their commission
-- reclaimed (e.g. the client cancelled their policy after the deal went live).
-- Cancelled remains for deals that fell over BEFORE going live.

-- Drop whatever the existing status CHECK constraint happens to be called.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'deals'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%IN%'
  LOOP
    EXECUTE format('ALTER TABLE deals DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

-- Re-add the constraint with clawback included.
ALTER TABLE deals
  ADD CONSTRAINT deals_status_check
  CHECK (status IN (
    'not_yet_submitted',
    'in_processing',
    'on_risk_nyp',
    'paid',
    'cancelled',
    'clawback'
  ));
