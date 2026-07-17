-- Client nurture journeys (Guy's v2 document, built 16 Jul 2026 with
-- Guy + Poz in the room).
--
-- Button-first design: a seller or admin starts a journey on a case;
-- the steps are precomputed into journey_sends with dates; the cron
-- processes due sends inside allowed windows; ANY case status change
-- exits the journey immediately. One active journey per case.

CREATE TABLE IF NOT EXISTS client_journeys (
  id           SERIAL PRIMARY KEY,
  case_id      INTEGER NOT NULL REFERENCES clawback_cases(id),
  journey      TEXT NOT NULL CHECK (journey IN ('a','b','c','d')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','completed','stopped','exited')),
  started_by   TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  ended_reason TEXT
);

-- One active journey per case ("never run two journeys simultaneously").
CREATE UNIQUE INDEX IF NOT EXISTS client_journeys_one_active
  ON client_journeys(case_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS journey_sends (
  id            SERIAL PRIMARY KEY,
  journey_id    INTEGER NOT NULL REFERENCES client_journeys(id),
  case_id       INTEGER NOT NULL,
  step_key      TEXT NOT NULL,          -- e.g. 'a1_email', 'a1_sms'
  channel       TEXT NOT NULL CHECK (channel IN ('email','sms')),
  scheduled_for DATE NOT NULL,          -- day granularity; cron windows pick the tick
  sent_at       TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','failed','skipped')),
  detail        TEXT
);

CREATE INDEX IF NOT EXISTS journey_sends_due
  ON journey_sends(status, scheduled_for) WHERE status = 'pending';

-- History gains a 'journey' event type (start / stop / send / exit rows).
ALTER TABLE clawback_history DROP CONSTRAINT IF EXISTS clawback_history_event_type_check;
ALTER TABLE clawback_history ADD CONSTRAINT clawback_history_event_type_check
  CHECK (event_type IN (
    'created',
    'ebah_change',
    'status_change',
    'note',
    'contact_attempt',
    'money_off',
    'email_sent',
    'journey'
  ));
