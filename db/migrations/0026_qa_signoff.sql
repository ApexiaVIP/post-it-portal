-- Call QA sign-off and MI (7 Oct 2026). The AI flags; a reviewer
-- (Poz / Guy) confirms each observation standard, disclosure and
-- suitability finding, and gives the case a final outcome. Adviser
-- scores and the QA dashboard are built only on confirmed results, and
-- the AI-versus-reviewer agreement is the system's measured accuracy.

ALTER TABLE qa_cases
  ADD COLUMN IF NOT EXISTS deal_id        INT REFERENCES deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome        TEXT,
  ADD COLUMN IF NOT EXISTS outcome_notes  TEXT,
  ADD COLUMN IF NOT EXISTS outcome_by     TEXT,
  ADD COLUMN IF NOT EXISTS outcome_at     TIMESTAMPTZ;

ALTER TABLE qa_cases DROP CONSTRAINT IF EXISTS qa_cases_outcome_check;
ALTER TABLE qa_cases
  ADD CONSTRAINT qa_cases_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('approved', 'approved_with_actions', 'returned'));

-- One row per reviewed item of a run. Section, reference, label and the
-- AI's result are copied from the run when the reviewer confirms, so the
-- dashboard can group without unpacking the run JSON.
CREATE TABLE IF NOT EXISTS qa_review_items (
  run_id            INT         NOT NULL REFERENCES qa_runs(id),
  item_key          TEXT        NOT NULL,
  case_id           INT         NOT NULL REFERENCES qa_cases(id),
  section           TEXT        NOT NULL CHECK (section IN ('observation', 'disclosure', 'suitability')),
  ref               TEXT,
  label             TEXT        NOT NULL,
  mandatory         BOOLEAN     NOT NULL DEFAULT false,
  ai_result         TEXT        NOT NULL,
  confirmed_result  TEXT        NOT NULL,
  note              TEXT,
  reviewed_by       TEXT        NOT NULL,
  reviewed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, item_key)
);
CREATE INDEX IF NOT EXISTS qa_review_items_case_idx ON qa_review_items(case_id);
