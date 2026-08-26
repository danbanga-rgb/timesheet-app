// G7.5 expense-account probe.
//
// For each of the 4 Case A Intuit vendors (Mek/Sivakumar/Rumiya/Ravi),
// picks 1 recent settled Bill from qb_mirror, then enqueues ONE bill_query
// job with IncludeLineItems=true so the response carries ExpenseLineRet.
//
// After QBWC drains (~15 min), re-run with --inspect to parse the raw
// qbxml_response and report the AccountRef.FullName that each historical
// bill's line landed in. If consistent per vendor, seed qb_vendor_mappings
// with that account. If varied, escalate.
//
// Usage:
//   Enqueue:  SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/g75-expense-account-probe.cjs --enqueue
//   Inspect:  SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/g75-expense-account-probe.cjs --inspect <job_id>

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

// Case A vendor name fragments (case-insensitive substring match on qb_vendors.name).
// These are the 4 Intuit-paid contractor vendors per [[intuit-qb-layer-spec]].
// Contractor → QB vendor: Mek→Hovercloud, Sivakumar→Procal, Rumiya→Flawless, Ravi→Yara.
const CASE_A_HINTS = ['hovercloud', 'procal', 'flawless apps', 'yara solutions'];

const args = process.argv.slice(2);
const MODE = args[0];

async function pickBillsPerVendor() {
  const picks = [];
  for (const hint of CASE_A_HINTS) {
    // Server-side ilike — PostgREST 1000-row default cap silently truncates a
    // wholesale fetch; filter per-hint instead. See [[postgrest-max-rows-cap]].
    const { data: matches, error: vErr } = await supabase
      .from('qb_vendors').select('list_id, name').ilike('name', `%${hint}%`);
    if (vErr) throw vErr;
    if (matches.length === 0) { console.warn(`⚠ no qb_vendor matches "${hint}"`); continue; }
    if (matches.length > 1) console.warn(`⚠ multiple qb_vendors match "${hint}": ${matches.map(m => m.name).join(', ')} — using first`);
    const v = matches[0];

    // Recent bill for that vendor — mirror stores vendor_list_id + entity_kind='bill'.
    const { data: bills, error: bErr } = await supabase
      .from('qb_mirror')
      .select('entity_ref, ref_number, amount, queried_at')
      .eq('entity_kind', 'bill')
      .eq('vendor_list_id', v.list_id)
      .order('queried_at', { ascending: false })
      .limit(5);
    if (bErr) throw bErr;
    if (!bills || bills.length === 0) { console.warn(`⚠ no mirror bills for vendor "${v.name}"`); continue; }
    const b = bills[0];
    picks.push({ vendorName: v.name, vendorListId: v.list_id, billTxnId: b.entity_ref, billRef: b.ref_number, billAmount: b.amount });
  }
  return picks;
}

async function enqueue() {
  const picks = await pickBillsPerVendor();
  console.log('\nBills selected for probe:');
  for (const p of picks) console.log(`  ${p.vendorName.padEnd(25)} txnId=${p.billTxnId} ref=${p.billRef} amount=${p.billAmount}`);
  if (picks.length === 0) { console.error('No bills to probe. Abort.'); process.exit(1); }

  const payload = {
    txnIds: picks.map(p => p.billTxnId),
    includeLineItems: true,
    __audit_tag: 'g75-expense-probe',
  };

  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .insert({ kind: 'bill_query', payload, status: 'pending' })
    .select('id')
    .single();
  if (error) throw error;
  console.log(`\n✓ Enqueued qb_sync_jobs.id=${data.id}`);
  console.log(`  Wait for QBWC drain (typically ≤15 min).`);
  console.log(`  Then: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/g75-expense-account-probe.cjs --inspect ${data.id}`);
}

async function inspect(jobId) {
  const { data: job, error } = await supabase
    .from('qb_sync_jobs')
    .select('id, status, qbxml_response, error_msg, payload')
    .eq('id', jobId)
    .single();
  if (error) throw error;
  console.log(`Job ${job.id} status=${job.status}${job.error_msg ? ` error=${job.error_msg}` : ''}`);
  if (!job.qbxml_response) { console.log('No qbxml_response yet — QBWC hasn\'t drained. Try again later.'); return; }

  // Parse each BillRet block, then within each, its ExpenseLineRet.AccountRef.FullName.
  const xml = job.qbxml_response;
  const bills = xml.match(/<BillRet>[\s\S]*?<\/BillRet>/g) || [];
  console.log(`\nBillRets returned: ${bills.length}\n`);
  for (const bill of bills) {
    const txnId = (bill.match(/<TxnID>([^<]+)<\/TxnID>/) || [])[1] || '?';
    const refNum = (bill.match(/<RefNumber>([^<]+)<\/RefNumber>/) || [])[1] || '?';
    const vendorName = ((bill.match(/<VendorRef>[\s\S]*?<FullName>([^<]+)<\/FullName>[\s\S]*?<\/VendorRef>/) || [])[1]) || '?';
    console.log(`── Bill ${txnId}  vendor="${vendorName}"  ref=${refNum}`);
    const lines = bill.match(/<ExpenseLineRet>[\s\S]*?<\/ExpenseLineRet>/g) || [];
    if (lines.length === 0) { console.log('    (no ExpenseLineRet blocks)'); continue; }
    for (const line of lines) {
      const accountName = ((line.match(/<AccountRef>[\s\S]*?<FullName>([^<]+)<\/FullName>[\s\S]*?<\/AccountRef>/) || [])[1]) || '?';
      const amount = (line.match(/<Amount>([^<]+)<\/Amount>/) || [])[1] || '?';
      const memo = (line.match(/<Memo>([^<]+)<\/Memo>/) || [])[1] || '';
      console.log(`    amount=${amount.padStart(12)}  account="${accountName}"  memo="${memo}"`);
    }
  }
  console.log('\n→ If accounts are consistent per vendor, seed qb_vendor_mappings.default_expense_account_list_id (look up list_id in qb_accounts by full_name).');
}

(async () => {
  if (MODE === '--enqueue') return enqueue();
  if (MODE === '--inspect') {
    const jobId = Number(args[1]);
    if (!Number.isFinite(jobId)) { console.error('Usage: --inspect <job_id>'); process.exit(1); }
    return inspect(jobId);
  }
  console.error('Usage:');
  console.error('  --enqueue                Pick 4 recent Bills (one per Case A vendor) and enqueue a bill_query with IncludeLineItems=true');
  console.error('  --inspect <job_id>       Parse qbxml_response, report ExpenseLineRet.AccountRef per bill');
  process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
