-- Fix net_at_risk: subtract resold_amount as well as saved_amount.
--
-- Poz flagged the Jesua Lucena case (id=250) on 1 Jul 2026: the original
-- policy clawback was £134.85, the replacement policy generated £755.78
-- resold commission, and Hayder recorded the £755.78 as resold correctly.
-- But the dashboard still showed net_at_risk = £134.85 because the
-- generated column only subtracted saved_amount. It should treat resold
-- commission as offsetting the exposure too. Correct value for Lucena
-- becomes £0 (fully covered). The separate "net_position" concept (can
-- go negative = we made money on the swap) is computed on the fly by
-- callers, not stored.

ALTER TABLE clawback_cases
  DROP COLUMN IF EXISTS net_at_risk;

ALTER TABLE clawback_cases
  ADD COLUMN net_at_risk NUMERIC(12,2) GENERATED ALWAYS AS (
    GREATEST(
      COALESCE(final_clawback_due, clawback_due) - saved_amount - resold_amount,
      0
    )
  ) STORED;
