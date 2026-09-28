-- Welcome / thank-you email (Poz, 28 Sep 2026). The RECI sends the
-- client a "thank you for choosing TopQuote" email once a deal is On
-- Risk NYP. Four new per-deal fields feed it, plus a stamp so a client
-- is never welcomed twice by accident.
--
--   client_email       keyed in when Poz creates the record
--   policy_number      the insurer's policy number
--   policy_start_date  cover start date
--   first_dd_date      first Direct Debit collection date
--   welcome_sent_*     when / to whom / by whom the live email went

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS client_email       TEXT,
  ADD COLUMN IF NOT EXISTS policy_number      TEXT,
  ADD COLUMN IF NOT EXISTS policy_start_date  DATE,
  ADD COLUMN IF NOT EXISTS first_dd_date      DATE,
  ADD COLUMN IF NOT EXISTS welcome_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_sent_to    TEXT,
  ADD COLUMN IF NOT EXISTS welcome_sent_by    TEXT;
