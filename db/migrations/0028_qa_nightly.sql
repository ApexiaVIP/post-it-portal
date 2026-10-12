-- Call QA runs once a day (Jimmy, 13 Oct 2026): list new recordings in
-- the evening, transcribe and sort them overnight, check completed sales,
-- email a summary in the morning.
--
-- Overnight, a small cheap model reads each transcript to work out the
-- call type, the client's name and whether a sale was completed, so the
-- full (costlier) check only runs on completed sales.

ALTER TABLE qa_inbox ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE qa_inbox ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

-- { call_type, client_name, sale_completed, summary } from the overnight sort.
ALTER TABLE qa_calls ADD COLUMN IF NOT EXISTS classification JSONB;

ALTER TABLE qa_cases
  ADD COLUMN IF NOT EXISTS auto_created     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ready_for_check  BOOLEAN NOT NULL DEFAULT false;
