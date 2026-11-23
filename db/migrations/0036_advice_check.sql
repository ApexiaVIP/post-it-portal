-- Advice check (Guy, 22 Nov 2026). Before presenting advice, the seller
-- uploads their completed Fact Find sheet and types their intended
-- recommendation. The check matches the case to Guy's scenario sheet, lists
-- what is missing, drafts the justification and the Concert Hub notes, and
-- lists every statement so it can be tested against the recording later.
-- It runs in London like Call QA. Sellers see their own checks; Call QA
-- users (Jimmy, Pauline/Poz, Guy) see all of them.

CREATE TABLE IF NOT EXISTS advice_checks (
  id              SERIAL PRIMARY KEY,
  adviser_id      INT         REFERENCES advisers(id),
  created_by      TEXT        NOT NULL,
  -- First names only, as the seller types them (Guy: first names and ages are enough).
  client_label    TEXT        NOT NULL,
  case_type       TEXT        NOT NULL CHECK (case_type IN ('one_call', 'two_call')),
  fact_find_date  DATE        NOT NULL,
  recommendation  TEXT        NOT NULL,
  presented       BOOLEAN     NOT NULL DEFAULT false,
  -- Write the notes for the parts that are complete even if something is missing.
  notes_anyway    BOOLEAN     NOT NULL DEFAULT false,
  -- What the seller typed or pasted of the sheet, if anything.
  sheet_typed     TEXT,
  -- The sheet as the check used it: read from the uploaded pages (with
  -- surnames, dates of birth, addresses, contact, policy and bank details
  -- left out) plus anything typed. The pages are deleted once read.
  sheet_text      TEXT,
  status          TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'running', 'done', 'failed')),
  model           TEXT,
  result          JSONB,
  usage           JSONB,
  standards       JSONB,
  error           TEXT,
  -- The earlier check this one repeats after a callback.
  previous_id     INT         REFERENCES advice_checks(id),
  -- The Call QA sale it belongs to, once linked from the case page.
  qa_case_id      INT         REFERENCES qa_cases(id),
  linked_by       TEXT,
  linked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS advice_checks_adviser_idx ON advice_checks (adviser_id, created_at DESC);
CREATE INDEX IF NOT EXISTS advice_checks_case_idx ON advice_checks (qa_case_id);

-- Photos or scans of the sheet, held only until the sheet has been read.
CREATE TABLE IF NOT EXISTS advice_check_pages (
  id           SERIAL PRIMARY KEY,
  check_id     INT         NOT NULL REFERENCES advice_checks(id),
  page_no      INT         NOT NULL,
  mime_type    TEXT        NOT NULL,
  data         BYTEA       NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advice_check_pages_check_idx ON advice_check_pages (check_id, page_no);

-- The advice check's own documents (the framework, the aide memoire,
-- Openwork's expectations, Guy's scenario sheet and his instructions) are
-- kept with the other standards but used only by the advice check.
ALTER TABLE qa_rulesets DROP CONSTRAINT IF EXISTS qa_rulesets_applies_to_check;
ALTER TABLE qa_rulesets
  ADD CONSTRAINT qa_rulesets_applies_to_check
  CHECK (applies_to IN ('all', 'one_call', 'two_call', 'advice_check'));

-- Gate 4: the advice check's statements tested against the recorded calls.
ALTER TABLE qa_runs DROP CONSTRAINT IF EXISTS qa_runs_gate_check;
ALTER TABLE qa_runs ADD CONSTRAINT qa_runs_gate_check CHECK (gate IN (1, 2, 3, 4));
