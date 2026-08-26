// Mirror completeness backfill — populate qb_mirror.data.expense_lines for
// historical bill rows. The parser + drain changes shipped 2026-08-26; after
// this pass, hourly pg_cron catches new bills automatically, but existing
// mirror rows still have expense_lines=null.
//
// Strategy: iterate qb_mirror bills WHERE data->>'expense_lines' IS NULL,
// batch by 100 TxnIDs, enqueue one bill_query per batch with
// includeLineItems=true. QBWC drains at ~28 jobs / 44s (per sessionProgress
// batch-15 timing), so 1500 bills / 100 = 15 jobs = one drain cycle.
//
// Usage:
//   Dry-run:  SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/mirror-backfill-expense-lines.cjs
//   Enqueue:  SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/mirror-backfill-expense-lines.cjs --enqueue

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

const DO_ENQUEUE = process.argv.includes('--enqueue');
const BATCH_SIZE = 100;   // one bill_query per 100 TxnIDs

(async () => {
  // Fetch all bill rows lacking expense_lines. Server-side filter to bypass
  // the 10k cap on wholesale fetches (memory: postgrest-max-rows-cap).
  let allBills = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('qb_mirror')
      .select('entity_ref, ref_number, vendor_list_id')
      .eq('entity_kind', 'bill')
      .is('data->>expense_lines', null)   // JSONB text-coerced null check
      .range(from, from + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allBills = allBills.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`Bill rows missing expense_lines: ${allBills.length}`);
  if (allBills.length === 0) { console.log('Nothing to backfill.'); return; }

  // Chunk into batches of BATCH_SIZE TxnIDs.
  const batches = [];
  for (let i = 0; i < allBills.length; i += BATCH_SIZE) {
    batches.push(allBills.slice(i, i + BATCH_SIZE).map(b => b.entity_ref));
  }
  console.log(`Will enqueue ${batches.length} bill_query job(s), ${BATCH_SIZE} TxnIDs each (max).`);
  console.log(`Estimated drain time at ~28 jobs/44s: ${Math.ceil((batches.length * 44) / 28)}s.`);

  if (!DO_ENQUEUE) {
    console.log('DRY-RUN. Re-run with --enqueue to actually insert jobs.');
    console.log('\nSample TxnIDs (first 10 of first batch):');
    batches[0].slice(0, 10).forEach(t => console.log(' ', t));
    return;
  }

  const rows = batches.map(txnIds => ({
    kind: 'bill_query',
    payload: {
      txnIds,
      includeLineItems: true,
      __audit_tag: 'mirror-backfill-expense-lines',
    },
    status: 'pending',
  }));

  const { data: inserted, error: insErr } = await supabase
    .from('qb_sync_jobs')
    .insert(rows)
    .select('id');
  if (insErr) { console.error(insErr); process.exit(1); }
  console.log(`\nEnqueued ${inserted.length} bill_query job(s):`, inserted.map(r => r.id).join(', '));
  console.log('Drain via QBWC on next poll. Verify with:');
  console.log(`  SELECT count(*) FROM qb_mirror WHERE entity_kind='bill' AND data->>'expense_lines' IS NULL;`);
})().catch(e => { console.error(e); process.exit(1); });
