-- Sale recordings on the RECI board (Poz, 15 Oct 2026). When a seller
-- completes a sale they download the call recording(s) from 3CX and drop
-- them on their own board, which creates the sale. Poz listens from the
-- sale and decides whether to send each recording to Call QA.
--
-- The audio is held here (London database) only until Poz sends it for
-- transcription or deletes it, and is deleted automatically after 30 days
-- either way.

CREATE TABLE IF NOT EXISTS deal_recordings (
  id               SERIAL PRIMARY KEY,
  deal_id          INT REFERENCES deals(id) ON DELETE CASCADE,
  adviser_id       INT NOT NULL REFERENCES advisers(id),
  filename         TEXT,
  mime_type        TEXT,
  size_bytes       BIGINT NOT NULL,
  client_phone     TEXT,
  call_started_at  TIMESTAMPTZ,
  -- uploading: chunks arriving; held: audio here, playable;
  -- sent: handed to Call QA (audio moved there); deleted: audio removed
  status           TEXT NOT NULL DEFAULT 'uploading'
                   CHECK (status IN ('uploading', 'held', 'sent', 'deleted')),
  qa_call_id       INT REFERENCES qa_calls(id) ON DELETE SET NULL,
  uploaded_by      TEXT NOT NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  audio_removed_at TIMESTAMPTZ,
  removed_by       TEXT
);
CREATE INDEX IF NOT EXISTS deal_recordings_deal_idx ON deal_recordings (deal_id);
CREATE INDEX IF NOT EXISTS deal_recordings_held_idx ON deal_recordings (uploaded_at) WHERE status IN ('uploading', 'held');

CREATE TABLE IF NOT EXISTS deal_recording_chunks (
  recording_id INT NOT NULL REFERENCES deal_recordings(id) ON DELETE CASCADE,
  seq          INT NOT NULL,
  data         BYTEA NOT NULL,
  PRIMARY KEY (recording_id, seq)
);
