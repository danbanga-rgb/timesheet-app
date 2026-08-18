// Audit convera_transactions.qb_billpmt_txn_id linkages.
//
// Motivation: pre-4caef92 bill_pmt_add jobs had sourceConveraTxnId=NULL, so the
// persist step couldn't identify which wire spawned each QB payment. Later manual
// backfill of qb_billpmt_txn_id was known to be sloppy — 4 wires already found
// mis-linked to wrong QB payments (wires 862, 871, 872, 958, corrected 2026-08-18).
// This scans all remaining wires with qb_billpmt_txn_id set and verifies each
// linkage against the actual bill_pmt_add job that produced that TxnID.
//
// A linkage is CORRECT when:
//   - The bill_pmt_add job whose response TxnID matches wire.qb_billpmt_txn_id
//     has payload.refNumber === wire.confirmation_number
//   - AND payload.applications sum === wire.subtotal (or matched invoice total)
//   - AND payload.payeeVendorName loosely matches wire.beneficiary_name
//
// Read-only. Prints a report; doesn't touch DB.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-wire-pmt-audit.cjs

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

// Loose vendor-name match: strip diacritics, uppercase, keep alphanumerics only.
// Then check that either string contains the other.
function normVendor(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
function vendorLooseMatch(a, b) {
  const na = normVendor(a), nb = normVendor(b);
  if (!na || !nb) return false;
  const short = na.length < nb.length ? na : nb;
  const long  = na.length < nb.length ? nb : na;
  return long.includes(short.slice(0, Math.min(10, short.length)));
}

(async () => {
  const { data: wires } = await supabase
    .from('convera_transactions')
    .select('id, confirmation_number, beneficiary_name, subtotal, qb_billpmt_txn_id')
    .not('qb_billpmt_txn_id', 'is', null)
    .order('id');
  console.log(`Wires with qb_billpmt_txn_id set: ${wires.length}`);

  // Load ALL done bill_pmt_add jobs and index by response TxnID.
  const { data: jobs } = await supabase
    .from('qb_sync_jobs')
    .select('id, payload, qbxml_response')
    .eq('kind', 'bill_pmt_add')
    .eq('status', 'done');
  const byTxnId = new Map();  // pmt TxnID → { jobId, payload }
  for (const j of jobs) {
    const m = /<TxnID>([^<]+)<\/TxnID>/.exec(j.qbxml_response || '');
    if (!m) continue;
    byTxnId.set(m[1], { jobId: j.id, payload: j.payload });
  }
  console.log(`Indexed ${byTxnId.size} bill_pmt_add jobs by response TxnID.`);

  const mismatches = [];
  const orphans = [];
  const okCount = { total: 0 };
  for (const w of wires) {
    const linked = byTxnId.get(w.qb_billpmt_txn_id);
    if (!linked) {
      orphans.push({ w });
      continue;
    }
    const p = linked.payload || {};
    const paidAmount = (p.applications || []).reduce((s, a) => s + (Number(a.paymentAmount) || 0), 0);
    const confMatch  = p.refNumber === w.confirmation_number;
    const amtMatch   = Math.abs(paidAmount - Number(w.subtotal)) < 0.01;
    const vendorMatch = vendorLooseMatch(p.payeeVendorName, w.beneficiary_name);
    if (confMatch && amtMatch && vendorMatch) {
      okCount.total++;
    } else {
      mismatches.push({
        w,
        job: linked.jobId,
        payload: p,
        paidAmount,
        signals: { confMatch, amtMatch, vendorMatch },
      });
    }
  }

  console.log(`\n─── Wire→pmt audit report ───`);
  console.log(`OK:         ${okCount.total}`);
  console.log(`MISMATCH:   ${mismatches.length}`);
  console.log(`ORPHAN (TxnID not in any known bill_pmt_add job): ${orphans.length}`);

  if (mismatches.length > 0) {
    console.log(`\n─── MISMATCHES ───`);
    for (const m of mismatches) {
      console.log(`  wire ${m.w.id} conf=${m.w.confirmation_number} beneficiary="${m.w.beneficiary_name.slice(0,50)}" subtotal=$${m.w.subtotal}`);
      console.log(`    qb_billpmt_txn_id=${m.w.qb_billpmt_txn_id} → job ${m.job}`);
      console.log(`    job says: refNumber=${m.payload.refNumber} vendor="${m.payload.payeeVendorName}" amount=$${m.paidAmount}`);
      console.log(`    signals: conf=${m.signals.confMatch?'✓':'✗'} amt=${m.signals.amtMatch?'✓':'✗'} vendor=${m.signals.vendorMatch?'✓':'✗'}`);
    }
  }
  if (orphans.length > 0) {
    console.log(`\n─── ORPHANS (TxnID not from any bill_pmt_add job we ran) ───`);
    for (const o of orphans) {
      console.log(`  wire ${o.w.id} conf=${o.w.confirmation_number} qb_billpmt_txn_id=${o.w.qb_billpmt_txn_id}`);
    }
  }
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
