-- Cancellation reasons + notes on deals, email on advisers.
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT
        CHECK (cancellation_reason IS NULL OR cancellation_reason IN ('npw','postponed','declined','other'));

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS cancellation_notes  TEXT;

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS cancelled_by        TEXT;

ALTER TABLE advisers
    ADD COLUMN IF NOT EXISTS email               TEXT;

-- Helpful index for the weekly Cancellations block.
CREATE INDEX IF NOT EXISTS idx_deals_cancelled
    ON deals(adviser_id, year, week)
    WHERE status = 'cancelled';
