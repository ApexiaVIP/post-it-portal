-- Once-a-day jobs record the London date they ran, so a clock change or
-- a repeated cron call can't send the same daily email twice (Oct 2026:
-- the stale-case digest moved to London time after BST ended).
CREATE TABLE IF NOT EXISTS job_runs (
  job      TEXT        NOT NULL,
  run_date DATE        NOT NULL,
  ran_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job, run_date)
);
