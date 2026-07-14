-- Add 'period_locked' and 'success_zero' to the parse_status CHECK constraint on
-- email_import_log. Both values are used by ingest-timesheet but were never
-- allowed by the constraint, so every period_locked and success_zero write has
-- been silently rejected since those features shipped. Applied to prod
-- 2026-07-14 after Marinela Sumanjski's Jul 6-12 timesheet was rejected by the
-- lock gate but produced no DB row (only an accounting alert).

ALTER TABLE email_import_log
  DROP CONSTRAINT email_import_log_parse_status_check;

ALTER TABLE email_import_log
  ADD CONSTRAINT email_import_log_parse_status_check
  CHECK (parse_status = ANY (ARRAY[
    'success'::text,
    'partial'::text,
    'failed'::text,
    'duplicate'::text,
    'forwarded'::text,
    'deleted'::text,
    'correction'::text,
    'correction_pending'::text,
    'period_locked'::text,
    'success_zero'::text
  ]));
