-- Surface the EBAH "Master Agent No" and "Agent No" columns on the Clawback
-- Dashboard. These weren't in the original schema; we stored them in the
-- parser's raw blob but never persisted. Adding them as proper columns so
-- they show up in the case table and can be searched/filtered.

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS master_agent_no TEXT;

ALTER TABLE clawback_cases
  ADD COLUMN IF NOT EXISTS agent_no TEXT;

CREATE INDEX IF NOT EXISTS clawback_cases_agent_no_idx ON clawback_cases(agent_no);
