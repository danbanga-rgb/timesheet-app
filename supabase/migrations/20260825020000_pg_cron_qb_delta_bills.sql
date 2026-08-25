-- pg_cron scheduler S1: hourly delta bill_query.
--
-- Every hour at :17, enqueue one qb_sync_jobs.bill_query with a 90-minute
-- lookback window in QB's local time. QBWC polls every ~15 min so the
-- delta window covers the max latency + 60 min interval + safety.
--
-- Design decisions (2026-08-25 delta reads probe verified):
--   - QB bumps TimeModified when IsPaid flips → delta reads are viable
--   - qbXML BillQueryRq iterator form:
--       MaxReturned first, then <ModifiedDateRangeFilter><FromModifiedDate/>...
--   - QB interprets FromModifiedDate in the QB machine's LOCAL timezone
--     (probe 604 zero-matched because we sent UTC; fix by computing in
--     America/Los_Angeles).
--   - :17 minute avoids the :00/:30 herd on QBWC polling.
--   - 90-min lookback = 60-min cron interval + 30-min QBWC-latency buffer.
--     Overlap is fine — response persist is idempotent (upserts by TxnID).
--
-- cron.schedule upserts by jobname so re-running this migration is safe.

SELECT cron.schedule(
  'qb-delta-bills',
  '17 * * * *',
  $$
    INSERT INTO qb_sync_jobs (kind, payload, status)
    VALUES (
      'bill_query',
      jsonb_build_object(
        'fromModifiedDate', to_char(
          (now() AT TIME ZONE 'America/Los_Angeles') - interval '90 minutes',
          'YYYY-MM-DD"T"HH24:MI:SS'
        ),
        'maxReturned', 200,
        '__source', 'pg_cron_delta_bills'
      ),
      'pending'
    )
  $$
);
