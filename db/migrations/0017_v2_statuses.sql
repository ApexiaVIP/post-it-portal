-- V2 status taxonomy (Guy's spec, agreed 10 Jul 2026).
--
-- Replaces the 7-status model with Off/On pairs mirroring the EBAH
-- trigger categories. See src/lib/reci/status.ts for the canonical
-- definition. Existing rows are mapped:
--
--   open        -> open (renders "Not worked")
--   saved       -> saved_cfo when the warning says cancelled-from-
--                  outset, else saved_lapse
--   resold      -> resold_on
--   reinstated  -> dd_reinstated
--   redraw      -> redraw_on when the On amount covers the Off (a
--                  completed redraw), else redraw_off
--   dead        -> dead_client when lost_reason='dead_client', else
--                  lost_cfo / lost_lapse by warning. dead_contact
--                  cases stay in the Lost bucket per Poz (10 Jul):
--                  the note/lost_reason carries the contact detail.
--   closed      -> closed
--
-- clawback_history old/new_value strings keep the legacy names; the
-- UI has a display fallback for them.

ALTER TABLE clawback_cases DROP CONSTRAINT IF EXISTS clawback_cases_status_check;

UPDATE clawback_cases SET status = CASE
  WHEN status = 'saved' THEN
    CASE WHEN ebah_warning ILIKE '%outset%' THEN 'saved_cfo' ELSE 'saved_lapse' END
  WHEN status = 'resold' THEN 'resold_on'
  WHEN status = 'reinstated' THEN 'dd_reinstated'
  WHEN status = 'redraw' THEN
    CASE WHEN redraw_on_amount >= redraw_off_amount THEN 'redraw_on' ELSE 'redraw_off' END
  WHEN status = 'dead' THEN
    CASE
      WHEN lost_reason = 'dead_client' THEN 'dead_client'
      WHEN ebah_warning ILIKE '%outset%' THEN 'lost_cfo'
      ELSE 'lost_lapse'
    END
  ELSE status
END
WHERE status IN ('saved','resold','reinstated','redraw','dead');

ALTER TABLE clawback_cases
  ADD CONSTRAINT clawback_cases_status_check
  CHECK (status IN (
    'open',
    'saved_cfo','saved_lapse','resold_on','redraw_on','dd_reinstated','bp_saved',
    'lost_cfo','lost_lapse','resold_off','redraw_off','dd_cancelled','bp_off',
    'dead_client','post_completion',
    'closed'
  ));
