-- Call QA: the 6 Oct 2026 update added a One Call guide, so standards are
-- now chosen per case type. 'all' = every case (the Openwork form);
-- 'one_call' / 'two_call' = only cases of that type.

ALTER TABLE qa_rulesets
  ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'all';

ALTER TABLE qa_rulesets DROP CONSTRAINT IF EXISTS qa_rulesets_applies_to_check;
ALTER TABLE qa_rulesets
  ADD CONSTRAINT qa_rulesets_applies_to_check CHECK (applies_to IN ('all', 'one_call', 'two_call'));
