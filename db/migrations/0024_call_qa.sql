-- Call QA (Guy + Poz brief, 6 Oct 2026): AI check on protection sales
-- cases before submission. Gate 1 (Confirmation Check) runs Checks 1-3
-- on the call transcripts; Gate 2 (after the suitability report) runs
-- Check 4. Access: Jimmy, Pauline/Poz and Guy only (CALL_QA_USERNAMES).
--
-- Audio is never kept: uploads land in qa_upload_chunks only until the
-- transcription finishes, then the chunks are deleted. What stays is the
-- timestamped, speaker-separated transcript.

CREATE TABLE IF NOT EXISTS qa_cases (
  id           SERIAL PRIMARY KEY,
  client_name  TEXT        NOT NULL,
  adviser_id   INT         REFERENCES advisers(id),
  case_type    TEXT        NOT NULL DEFAULT 'two_call'
               CHECK (case_type IN ('one_call', 'two_call')),
  notes        TEXT,
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS qa_calls (
  id                SERIAL PRIMARY KEY,
  case_id           INT         NOT NULL REFERENCES qa_cases(id),
  call_number       INT         NOT NULL,
  call_type         TEXT        NOT NULL
                    CHECK (call_type IN ('fact_find', 'advice', 'one_call', 'other')),
  call_date         DATE,
  filename          TEXT,
  mime_type         TEXT,
  size_bytes        BIGINT,
  status            TEXT        NOT NULL DEFAULT 'uploading'
                    CHECK (status IN ('uploading', 'transcribing', 'ready', 'failed')),
  error             TEXT,
  duration_seconds  NUMERIC(10,2),
  -- Speaker label the adviser was given by the transcription (e.g. "S0").
  -- Guessed automatically, correctable from the case page.
  adviser_speaker   TEXT,
  -- [{ s: "S0", start: 12.3, end: 15.9, text: "..." }]
  utterances        JSONB,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS qa_calls_case_idx ON qa_calls(case_id);

CREATE TABLE IF NOT EXISTS qa_upload_chunks (
  call_id  INT   NOT NULL REFERENCES qa_calls(id) ON DELETE CASCADE,
  seq      INT   NOT NULL,
  data     BYTEA NOT NULL,
  PRIMARY KEY (call_id, seq)
);

-- The suitability report for Gate 2 (a PDF saved from ConcertHub).
CREATE TABLE IF NOT EXISTS qa_documents (
  id           SERIAL PRIMARY KEY,
  case_id      INT         NOT NULL REFERENCES qa_cases(id),
  kind         TEXT        NOT NULL DEFAULT 'suitability_report',
  filename     TEXT,
  mime_type    TEXT        NOT NULL,
  data         BYTEA       NOT NULL,
  uploaded_by  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS qa_documents_case_idx ON qa_documents(case_id);

-- The standards calls are checked against, held as data so a new
-- Openwork form or script is a content update, not a rebuild.
CREATE TABLE IF NOT EXISTS qa_rulesets (
  key              TEXT PRIMARY KEY,
  title            TEXT        NOT NULL,
  content          TEXT        NOT NULL,
  source_filename  TEXT,
  sort_order       INT         NOT NULL DEFAULT 0,
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qa_runs (
  id           SERIAL PRIMARY KEY,
  case_id      INT         NOT NULL REFERENCES qa_cases(id),
  gate         INT         NOT NULL CHECK (gate IN (1, 2)),
  status       TEXT        NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'done', 'failed')),
  model        TEXT,
  result       JSONB,
  error        TEXT,
  usage        JSONB,
  started_by   TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS qa_runs_case_idx ON qa_runs(case_id, gate, started_at DESC);
