-- Sale recordings, agreed process (Jimmy with Guy + Poz, 15 Oct 2026):
--   the agent drops the 3CX recording on their board with the client's
--   surname and the call type (FF / AC / Both); the sale goes into Poz's
--   listening pool; Poz listens and presses Transcribe for that sale only.
--   This is the only way calls get transcribed. The recording stays saved
--   against the sale for future reference.

ALTER TABLE deal_recordings
  ADD COLUMN IF NOT EXISTS call_type   TEXT CHECK (call_type IN ('fact_find', 'advice', 'one_call')),
  ADD COLUMN IF NOT EXISTS listened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS listened_by TEXT;

-- The pool: held recordings Poz hasn't transcribed or marked as listened.
CREATE INDEX IF NOT EXISTS deal_recordings_pool_idx
  ON deal_recordings (deal_id) WHERE status = 'held' AND qa_call_id IS NULL AND listened_at IS NULL;

-- Set while a Transcribe press is sending the sale's recordings, so a
-- double click can't send anything twice.
ALTER TABLE deal_recordings ADD COLUMN IF NOT EXISTS transcribe_started_at TIMESTAMPTZ;
