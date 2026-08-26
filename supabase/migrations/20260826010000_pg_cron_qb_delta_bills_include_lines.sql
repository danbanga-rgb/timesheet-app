-- Mirror completeness pass: flip pg_cron qb-delta-bills to request line detail.
--
-- Before: bill_query without includeLineItems (header-only response).
-- After:  bill_query with includeLineItems=true so QB returns ExpenseLineRet
--         blocks. Parser (updated same day) extracts them; drain handler
--         writes them into qb_mirror.data.expense_lines.
--
-- Motivation: G7.5 expense-account probe forced a one-off manual bill_query
-- to answer "what account did the accountant post to?" Building this into
-- the hourly delta ends the class of ad-hoc probes. See qb_expense_account_
-- conventions memory for the underlying use case.
--
-- Cost: QB response payload grows (~2-3x for typical contractor bills with
-- 1-2 lines). Still fits comfortably in the drain window.
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
        'includeLineItems', true,
        '__source', 'pg_cron_delta_bills'
      ),
      'pending'
    )
  $$
);
