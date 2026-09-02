-- Confirmation Planner (Poz, 2 Sep 2026): three new per-deal fields so
-- the Reci can generate the planner she currently types up separately.
--
--   booked_date  when the seller booked the deal. Defaults to the day
--                the deal was entered on the Reci (Poz confirms same or
--                next day); editable where that assumption is wrong.
--   policy_type  SLL / JDL / SDL etc, straight from her planner column.
--   resell_cb    clawback attached to a resell; planner reports
--                net commission = commission - resell_cb.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS booked_date DATE,
  ADD COLUMN IF NOT EXISTS policy_type TEXT,
  ADD COLUMN IF NOT EXISTS resell_cb NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Existing deals: assume booked the day they were entered.
UPDATE deals SET booked_date = created_at::date WHERE booked_date IS NULL;
