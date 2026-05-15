-- In-processing sub-stage tracker on deals.
-- Only meaningful when status = 'in_processing'; values are preserved if
-- the deal moves to another status (the UI just hides the dropdown).
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS in_processing_stage TEXT
        CHECK (in_processing_stage IS NULL
               OR in_processing_stage IN ('checked','gpr','misc','ns','rfi','sot'));
