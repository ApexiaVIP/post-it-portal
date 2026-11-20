-- Call QA callback list (Poz and Guy, 19 Nov 2026). From the summary,
-- Pauline sends the seller the list of points to put right with the client
-- before the sale is submitted. When and by whom it went is kept on the case.
ALTER TABLE qa_cases ADD COLUMN IF NOT EXISTS callback_sent_at TIMESTAMPTZ;
ALTER TABLE qa_cases ADD COLUMN IF NOT EXISTS callback_sent_by TEXT;

-- Draft suitability report (Guy, 20 Nov 2026): written from the calls for the
-- seller to check and use. Stored as a run with gate 3 next to the checks.
ALTER TABLE qa_runs DROP CONSTRAINT IF EXISTS qa_runs_gate_check;
ALTER TABLE qa_runs ADD CONSTRAINT qa_runs_gate_check CHECK (gate IN (1, 2, 3));
