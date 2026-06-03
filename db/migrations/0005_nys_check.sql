-- Pre-submit "Checked" sub-status on Not Yet Submitted deals.
-- Pauline reviews each NYS deal; if she's not happy she sets it to
-- 'checked' and types a note. The portal then emails the seller so
-- they can address it. Cleared automatically when the deal is moved
-- out of NYS into In Processing or On Risk NYP.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS nys_check_status TEXT
    CHECK (nys_check_status IS NULL OR nys_check_status IN ('checked'));

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS nys_check_notes TEXT;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS nys_checked_at TIMESTAMPTZ;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS nys_checked_by TEXT;
