-- Pauline's brief: "Old openwork business is not getting passed over as CB
-- at the moment so we need to keep a tally of this so that any new CB can
-- be easily found on the system."
--
-- Adds an editable Source flag per case so Pauline can mark each row as
-- Old OW / New OW / Other. Eventually we'll bulk-set this from the master
-- agent code (once Pauline sends the code list), but for now she flags
-- manually as she works through cases.

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS source TEXT
    CHECK (source IS NULL OR source IN ('old_ow','new_ow','other'));

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS source_updated_by TEXT;

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS clawback_cases_source_idx
  ON clawback_cases(source) WHERE source IS NOT NULL;
