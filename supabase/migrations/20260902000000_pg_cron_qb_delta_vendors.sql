-- pg_cron scheduler: periodic vendor_query to refresh qb_mirror vendors.
--
-- Motivation: qb-delta-bills (:17 hourly) keeps bills fresh, but there was
-- no equivalent for vendors. When the accountant added new vendors in QB,
-- they never surfaced in our views until someone manually inserted a
-- vendor_query job. This closes that gap.
--
-- Cadence: every 2 hours at :37. Vendor list changes infrequently
-- (accountant adds a vendor maybe 1-2×/week), and VendorQueryRq has no
-- delta filter exposed in our builder yet — each call enumerates ALL
-- ~1200 vendors — so 12 runs/day is a reasonable balance. The UI "Sync
-- Vendors" button covers immediate cases; this cron is the safety net.
--
-- :37 offset avoids the :00/:30 herd and doesn't collide with
-- qb-delta-bills (:17) or monitor-health (:47).
--
-- cron.schedule upserts by jobname so re-running this migration is safe.

SELECT cron.schedule(
  'qb-delta-vendors',
  '37 */2 * * *',
  $$
    INSERT INTO qb_sync_jobs (kind, payload, status)
    VALUES (
      'vendor_query',
      jsonb_build_object('__source', 'pg_cron_delta_vendors'),
      'pending'
    )
  $$
);
