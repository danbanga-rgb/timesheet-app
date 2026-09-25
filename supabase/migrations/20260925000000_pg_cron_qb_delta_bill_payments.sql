-- pg_cron qb-delta-bill-payments — hourly delta read of QB bill payments.
--
-- Before: qb_mirror bill_payment rows were seeded once (2026-08-20) and never
-- refreshed. mirrorDeviationCheck (bank-drift guardrail on every Convera
-- bill_pmt push) samples those rows, so vendors first paid after the seed had
-- no protection, and our own pushed payments never reached the mirror.
--
-- After: hourly BillPaymentCheckQueryRq with ModifiedDateRangeFilter, same
-- 90-minute lookback + America/Los_Angeles local-time rule as qb-delta-bills
-- (QB reads FromModifiedDate in the QB machine's local zone — see
-- qb-delta-reads-facts). IncludeLineItems=true so AppliedToTxnRet (which
-- bills each payment settled) lands in qb_mirror.data.applied_to_bills.
--
-- Minute :47 keeps it clear of qb-delta-bills (:17) and qb-delta-vendors (:37).
-- Read-only query job; the push queue is unaffected.
-- cron.schedule upserts by jobname, so re-running is safe.

SELECT cron.schedule(
  'qb-delta-bill-payments',
  '47 * * * *',
  $$
    INSERT INTO qb_sync_jobs (kind, payload, status)
    VALUES (
      'bill_pmt_query',
      jsonb_build_object(
        'fromModifiedDate', to_char(
          (now() AT TIME ZONE 'America/Los_Angeles') - interval '90 minutes',
          'YYYY-MM-DD"T"HH24:MI:SS'
        ),
        'maxReturned', 200,
        'includeLineItems', true,
        '__source', 'pg_cron_delta_bill_payments'
      ),
      'pending'
    )
  $$
);
