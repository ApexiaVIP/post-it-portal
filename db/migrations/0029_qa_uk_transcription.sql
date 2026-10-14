-- Call QA processing moves to Amazon's London data centre (Poz + Jimmy,
-- 14 Oct 2026). Transcription now runs as an Amazon Transcribe job: the
-- recording sits in TopQuote's London S3 bucket only until the job
-- finishes, then both the audio and the job are deleted.

ALTER TABLE qa_calls
  ADD COLUMN IF NOT EXISTS transcribe_job        TEXT,
  ADD COLUMN IF NOT EXISTS audio_key             TEXT,
  ADD COLUMN IF NOT EXISTS transcribe_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS qa_calls_transcribing_idx
  ON qa_calls (id) WHERE status = 'transcribing' AND deleted_at IS NULL;
