-- Post-completion Clawback (CB) tracking. Separate from the front-of-book
-- Business Tracker per Pauline's brief: legacy data is messy, so net-sale
-- offsets are deferred until Guy decides we want them.
--
-- Tables:
--   clawback_cases      one row per policy number, upserted on every EBAH
--                       re-upload. Holds the latest L&G state plus the
--                       editable workflow fields (status_override, notes,
--                       money-off events).
--   clawback_uploads    audit log: who uploaded which file, when, row deltas.
--   clawback_history    per-case event log: status changes, note adds,
--                       contact attempts, money-off events (saved / resold /
--                       dead-in-water).
--   clawback_agent_map  canonical map from L&G "Sales Agent Name" strings to
--                       a RECI adviser_id, or to a sentinel bucket
--                       ('xstaff' | 'legacy'). New strings on upload land in
--                       'needs_review' for Pauline to assign once.

CREATE TABLE IF NOT EXISTS clawback_agent_map (
  ebah_agent_name   TEXT PRIMARY KEY,                -- exact L&G string, trimmed
  adviser_id        INTEGER REFERENCES advisers(id), -- nullable: only set when mapped to a real adviser
  bucket            TEXT NOT NULL CHECK (bucket IN ('adviser','xstaff','legacy','needs_review')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clawback_uploads (
  id                SERIAL PRIMARY KEY,
  filename          TEXT NOT NULL,
  provider          TEXT NOT NULL DEFAULT 'l&g',     -- ready for aviva/lv/royal london later
  uploaded_by       TEXT NOT NULL,                   -- session username
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_date       DATE,                            -- the "Policies at Risk at DD/MM/YYYY" date from the file
  rows_total        INTEGER NOT NULL DEFAULT 0,
  rows_inserted     INTEGER NOT NULL DEFAULT 0,
  rows_updated      INTEGER NOT NULL DEFAULT 0,
  rows_unchanged    INTEGER NOT NULL DEFAULT 0,
  rows_unmatched    INTEGER NOT NULL DEFAULT 0,      -- agent string in needs_review
  notes             TEXT
);

CREATE TABLE IF NOT EXISTS clawback_cases (
  id                  SERIAL PRIMARY KEY,
  -- Identity (from EBAH)
  policy_number       TEXT NOT NULL UNIQUE,
  provider            TEXT NOT NULL DEFAULT 'l&g',
  -- Client
  client_name         TEXT NOT NULL,                 -- raw EBAH string ("Mr/Mrs/Miss First Last")
  client_first_name   TEXT,
  client_last_name    TEXT,
  client_dob          DATE,
  client_email        TEXT,
  client_phone        TEXT,
  postcode            TEXT,
  address             TEXT,                          -- joined Address 1-4, comma separated
  -- Policy
  policy_type         TEXT,                          -- "Life Insurance with Critical Illness Extra" etc
  net_premium         NUMERIC(12,2),
  premium_outstanding NUMERIC(12,2),
  policy_start_date   DATE,
  off_risk_date       DATE,
  -- Clawback specifics
  clawback_due        NUMERIC(12,2) NOT NULL DEFAULT 0,
  clawback_date       DATE,
  -- Agent mapping
  ebah_agent_name     TEXT NOT NULL,                 -- the exact string from EBAH, trimmed
  adviser_id          INTEGER REFERENCES advisers(id),  -- nullable when in xstaff/legacy bucket
  agent_bucket        TEXT NOT NULL DEFAULT 'needs_review'
                      CHECK (agent_bucket IN ('adviser','xstaff','legacy','needs_review')),
  -- Status (mirrors EBAH "Warning" but extended with workflow states)
  ebah_warning        TEXT,                          -- raw from file: Lapse / Bounced DD / etc
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN (
                        'open',         -- newly notified, no action yet
                        'saved',        -- adviser saved it -- no CB taken
                        'resold',       -- replaced with a new sale, separate £ credit recorded
                        'dead',         -- nothing can be done, CB stands
                        'reinstated',   -- DD back on, awaiting confirmation
                        'closed'        -- final state once L&G confirms outcome
                      )),
  status_note         TEXT,                          -- free-text on status change
  -- Money tracking (running totals, populated by clawback_history events)
  saved_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  resold_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_at_risk         NUMERIC(12,2) GENERATED ALWAYS AS (
                        GREATEST(clawback_due - saved_amount, 0)
                      ) STORED,
  -- Legacy/Openwork flag
  legacy_openwork_not_passed BOOLEAN NOT NULL DEFAULT false,
  -- Notify state
  notified_at         TIMESTAMPTZ,                   -- when the first new-notification email went out
  resolved_at         TIMESTAMPTZ,
  -- Bookkeeping
  first_seen_upload_id INTEGER REFERENCES clawback_uploads(id),
  last_seen_upload_id  INTEGER REFERENCES clawback_uploads(id),
  notification_week    INTEGER,                       -- ISO week of first notification
  notification_year    INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clawback_cases_status_idx        ON clawback_cases(status);
CREATE INDEX IF NOT EXISTS clawback_cases_adviser_idx       ON clawback_cases(adviser_id);
CREATE INDEX IF NOT EXISTS clawback_cases_bucket_idx        ON clawback_cases(agent_bucket);
CREATE INDEX IF NOT EXISTS clawback_cases_week_idx          ON clawback_cases(notification_year, notification_week);
CREATE INDEX IF NOT EXISTS clawback_cases_clawback_date_idx ON clawback_cases(clawback_date);

CREATE TABLE IF NOT EXISTS clawback_history (
  id              SERIAL PRIMARY KEY,
  case_id         INTEGER NOT NULL REFERENCES clawback_cases(id) ON DELETE CASCADE,
  upload_id       INTEGER REFERENCES clawback_uploads(id),
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'created',
                    'ebah_change',     -- a field changed on re-upload
                    'status_change',
                    'note',
                    'contact_attempt', -- "called client", "left vm"
                    'money_off',       -- saved / resold £ recorded
                    'email_sent'
                  )),
  field           TEXT,                -- for ebah_change: which field
  old_value       TEXT,
  new_value       TEXT,
  amount          NUMERIC(12,2),       -- for money_off events
  money_kind      TEXT CHECK (money_kind IS NULL OR money_kind IN ('saved','resold','reinstated_cancelled')),
  note            TEXT,
  actor           TEXT NOT NULL,       -- session username or 'ebah-upload'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clawback_history_case_idx ON clawback_history(case_id, created_at DESC);
