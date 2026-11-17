-- Call QA: keep every issued version of each standard, so a call is checked
-- against the script that was in force on the day it was made (17 Nov 2026,
-- after Guy reissued the scripts on 21 Oct, 29 Oct and 4 Nov).
--
-- doc            the document, e.g. 'onecall_script'; one row per version
-- effective_from the issue date; a call on or after it uses this version
-- dated_by       which call's date picks the version: 'fact_find' (the first
--                call: fact find, or a one-call sale) or 'advice' (the last)
-- retired_at     set when a document is no longer used at all (the 6 Oct
--                call guides, replaced by the scripts themselves)

ALTER TABLE qa_rulesets ADD COLUMN IF NOT EXISTS doc TEXT;
ALTER TABLE qa_rulesets ADD COLUMN IF NOT EXISTS effective_from DATE;
ALTER TABLE qa_rulesets ADD COLUMN IF NOT EXISTS dated_by TEXT NOT NULL DEFAULT 'fact_find';
ALTER TABLE qa_rulesets ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

UPDATE qa_rulesets SET doc = key WHERE doc IS NULL;
UPDATE qa_rulesets SET effective_from = DATE '2026-10-06' WHERE effective_from IS NULL;
ALTER TABLE qa_rulesets ALTER COLUMN doc SET NOT NULL;
ALTER TABLE qa_rulesets ALTER COLUMN effective_from SET NOT NULL;

ALTER TABLE qa_rulesets DROP CONSTRAINT IF EXISTS qa_rulesets_dated_by_check;
ALTER TABLE qa_rulesets
  ADD CONSTRAINT qa_rulesets_dated_by_check CHECK (dated_by IN ('fact_find', 'advice'));

CREATE UNIQUE INDEX IF NOT EXISTS qa_rulesets_doc_version ON qa_rulesets (doc, effective_from);

-- Which versions each check used, shown on the report.
ALTER TABLE qa_runs ADD COLUMN IF NOT EXISTS standards JSONB;
