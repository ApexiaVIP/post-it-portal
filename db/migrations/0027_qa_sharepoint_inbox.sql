-- Call QA recordings inbox (12 Oct 2026). Recordings arrive in
-- Clearvolt's SharePoint (Shared Documents / Recordings / recordings).
-- A sync lists new files into qa_inbox, tagged with the adviser (from
-- their 3CX extension in the file name) and the client's number; Poz
-- assigns each to a case, which downloads and transcribes it.

ALTER TABLE advisers ADD COLUMN IF NOT EXISTS extension TEXT;

UPDATE advisers SET extension = '1009' WHERE name = 'Tan'     AND extension IS NULL;
UPDATE advisers SET extension = '1004' WHERE name = 'Hayder'  AND extension IS NULL;
UPDATE advisers SET extension = '1011' WHERE name = 'Gurdaht' AND extension IS NULL;
UPDATE advisers SET extension = '1019' WHERE name = 'Atikur'  AND extension IS NULL;
UPDATE advisers SET extension = '1002' WHERE name = 'Ben'     AND extension IS NULL;

-- The client's number on the case lets new recordings suggest it.
ALTER TABLE qa_cases ADD COLUMN IF NOT EXISTS client_phone TEXT;

CREATE TABLE IF NOT EXISTS qa_inbox (
  id                SERIAL PRIMARY KEY,
  drive_id          TEXT        NOT NULL,
  item_id           TEXT        NOT NULL,
  filename          TEXT        NOT NULL,
  folder_path       TEXT,
  size_bytes        BIGINT,
  mime_type         TEXT,
  file_created_at   TIMESTAMPTZ,
  -- Parsed from the file name (best effort; blank when not found).
  extension         TEXT,
  adviser_id        INT         REFERENCES advisers(id),
  client_phone      TEXT,
  call_started_at   TIMESTAMPTZ,
  status            TEXT        NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'assigned', 'ignored')),
  case_id           INT         REFERENCES qa_cases(id),
  call_id           INT         REFERENCES qa_calls(id),
  handled_by        TEXT,
  handled_at        TIMESTAMPTZ,
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drive_id, item_id)
);
CREATE INDEX IF NOT EXISTS qa_inbox_status_idx ON qa_inbox(status, call_started_at DESC);
CREATE INDEX IF NOT EXISTS qa_inbox_phone_idx ON qa_inbox(client_phone);

-- When the inbox last looked at SharePoint.
CREATE TABLE IF NOT EXISTS qa_sync_state (
  key         TEXT PRIMARY KEY,
  synced_at   TIMESTAMPTZ,
  detail      TEXT
);
