-- Adjust qb-delta-vendors cadence from every 2h to every 6h.
--
-- Reason: vendor list changes rarely (~1-2 additions per week per plan
-- baseline). Every 2h enqueues 12 vendor_query/day, each enumerating all
-- ~1200 vendors — overkill for the change rate. Every 6h (4×/day at :37)
-- is 3× lighter server work with negligible freshness impact. The v2 UI's
-- "Sync Now" link covers immediate-need cases; post-push refresh covers
-- push-driven cases.
--
-- cron.schedule upserts by jobname so re-running this migration replaces
-- the previous 2h schedule cleanly.
--
-- Related: [[qb-automation-v2-pivot]] V10 sync-surface conversation
-- 2026-09-24.

SELECT cron.schedule(
  'qb-delta-vendors',
  '37 */6 * * *',
  $$
    INSERT INTO qb_sync_jobs (kind, payload, status)
    VALUES (
      'vendor_query',
      jsonb_build_object('__source', 'pg_cron_delta_vendors'),
      'pending'
    )
  $$
);
