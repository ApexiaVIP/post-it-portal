-- Gate 6: the call 1 check (Guy, 26 Nov 2026). On a two-call sale whose fact
-- find call is in and whose advice call isn't yet, call 1 is checked on its
-- own against the Fact Find, the SAF and the observation form, and gives the
-- points to cover on call 2.
ALTER TABLE qa_runs DROP CONSTRAINT IF EXISTS qa_runs_gate_check;
ALTER TABLE qa_runs ADD CONSTRAINT qa_runs_gate_check CHECK (gate IN (1, 2, 3, 4, 5, 6));
