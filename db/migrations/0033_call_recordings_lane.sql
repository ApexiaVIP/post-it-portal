-- Call recordings column on the RECI board (Poz, 28 Oct 2026). A sale an
-- agent creates from a call recording lands here, in front of Not Yet
-- Submitted, until Poz drags it across. It is still a Not Yet Submitted
-- deal underneath, so totals and reports are unchanged.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS in_call_recordings BOOLEAN NOT NULL DEFAULT false;
