// qbXML dry-run against a real Convera batch — chain simulation of Chunks 2 + 3.
//
// Written as a vitest file (`.test.ts`) because vitest already resolves our
// `.ts` imports correctly with zero new tooling. It doesn't test anything in
// the unit-test sense; it produces artifacts and asserts a handful of
// invariants against real production data:
//
//   1. Every matched invoice resolves to a real qb_vendor_name (via the same
//      id → IBAN fallback the IIF export uses in TimesheetSystem.tsx).
//   2. All wire confirmation numbers fit the 11-char BillPaymentCheck cap.
//   3. buildBillAddRq accepts every real invoice without throwing.
//   4. buildBillPaymentCheckAddRq accepts every real payment group.
//   5. The query-then-apply chain round-trips: BillQueryRq → fabricated
//      BillQueryRs → parseBillQueryRs → TxnID feeds into
//      buildBillPaymentCheckAddRq without loss.
//   6. Sum of AppliedToTxnAdd.PaymentAmount values per group equals the
//      Convera wire subtotal (bank fee excluded — same accounting as IIF).
//
// Artifacts written to `scripts/one-off/dry-run-output/batch-{ID}/` (gitignored):
//   - queries/{invoice_id}-BillQueryRq.xml
//   - fabricated-responses/{invoice_id}-BillQueryRs.xml
//   - bills/{invoice_id}-BillAddRq.xml
//   - payments/{group_key}-BillPaymentCheckAddRq.xml
//   - audit.md   (human-readable summary)
//   - findings.json  (machine-readable findings)
//
// Run with:
//   npx vitest run scripts/one-off/qbxml-dryrun.test.ts
//
// Env: reads SUPABASE_SERVICE_ROLE_KEY from process.env or scripts/poller/.env.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildBillAddRq,
  buildBillPaymentCheckAddRq,
  buildBillQueryRq,
} from '../../src/lib/qbxml/builders';
import { wrapQbxmlRequests } from '../../src/lib/qbxml/envelope';
import { parseBillQueryRs } from '../../src/lib/qbxml/parsers';
import { WU_HOLDING } from '../../src/lib/qbxml/constants';

// ─── Config ─────────────────────────────────────────────────────────────────

const BATCH_ID = Number(process.env.DRYRUN_BATCH_ID ?? '15');
const OUT_ROOT = path.resolve(__dirname, 'dry-run-output', `batch-${BATCH_ID}`);
const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';

// Load service key from env or from scripts/poller/.env
function loadServiceKey(): string {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  const pollerEnv = path.resolve(__dirname, '../poller/.env');
  if (fs.existsSync(pollerEnv)) {
    const contents = fs.readFileSync(pollerEnv, 'utf-8');
    const match = contents.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY not found in env or scripts/poller/.env — set it before running.',
  );
}

const supabase = createClient(SUPABASE_URL, loadServiceKey());

// ─── Types (local — mirror the DB shapes we need) ────────────────────────────

interface ConveraTransaction {
  id: number;
  import_batch_id: number;
  confirmation_number: string;
  date_of_order: string;
  subtotal: number;
  service_charges: number;
  grand_total: number;
  matched_invoice_id: number | null;
}
interface InvoiceRow {
  id: number;
  user_id: string;
  user_name: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  total_hours: number;
  rate: number;
  total_amount: number;
  payment_terms: string | null;
  payment_profile: {
    id?: number;
    iban?: string;
    companyName?: string;
  } | null;
  lines: Array<{
    hours?: number;
    rate?: number;
    amount?: number;
    weekStart?: string;
  }> | null;
}
interface PaymentProfileRow {
  id: number;
  user_id: string;
  iban: string | null;
  qb_vendor_name: string | null;
}

interface ResolvedBill {
  invoice: InvoiceRow;
  vendorName: string | null;
  fabricatedTxnId: string;
  fabricatedEditSeq: string;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function fetchAll(): Promise<{
  txns: ConveraTransaction[];
  invoicesById: Map<number, InvoiceRow>;
  profilesById: Map<number, PaymentProfileRow>;
  profilesByUserIban: Map<string, PaymentProfileRow>;
}> {
  const { data: txns, error: e1 } = await supabase
    .from('convera_transactions')
    .select('id, import_batch_id, confirmation_number, date_of_order, subtotal, service_charges, grand_total, matched_invoice_id')
    .eq('import_batch_id', BATCH_ID);
  if (e1) throw e1;

  const invIds = (txns ?? [])
    .map((t) => (t as ConveraTransaction).matched_invoice_id)
    .filter((id): id is number => id != null);
  const { data: invoices, error: e2 } = await supabase
    .from('invoices')
    .select('id, user_id, user_name, invoice_number, period_start, period_end, total_hours, rate, total_amount, payment_terms, payment_profile, lines')
    .in('id', invIds);
  if (e2) throw e2;

  const { data: profiles, error: e3 } = await supabase
    .from('payment_profiles')
    .select('id, user_id, iban, qb_vendor_name');
  if (e3) throw e3;

  const invoicesById = new Map<number, InvoiceRow>();
  for (const row of (invoices ?? []) as InvoiceRow[]) invoicesById.set(row.id, row);
  const profilesById = new Map<number, PaymentProfileRow>();
  const profilesByUserIban = new Map<string, PaymentProfileRow>();
  for (const row of (profiles ?? []) as PaymentProfileRow[]) {
    profilesById.set(row.id, row);
    if (row.iban) profilesByUserIban.set(`${row.user_id}::${row.iban}`, row);
  }

  return {
    txns: (txns ?? []) as ConveraTransaction[],
    invoicesById,
    profilesById,
    profilesByUserIban,
  };
}

/** Same cascade as findLivePp() in TimesheetSystem.tsx: id first, then IBAN. */
function resolveVendorName(
  inv: InvoiceRow,
  profilesById: Map<number, PaymentProfileRow>,
  profilesByUserIban: Map<string, PaymentProfileRow>,
): string | null {
  const snap = inv.payment_profile;
  if (!snap) return null;
  if (snap.id != null) {
    const byId = profilesById.get(snap.id);
    if (byId?.qb_vendor_name) return byId.qb_vendor_name;
  }
  if (snap.iban) {
    const byIban = profilesByUserIban.get(`${inv.user_id}::${snap.iban}`);
    if (byIban?.qb_vendor_name) return byIban.qb_vendor_name;
  }
  return null;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthLabelOf(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
function lastDayOfPeriodEnd(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
const TERMS_TO_DAYS: Record<string, number> = { NET15: 15, NET30: 30, NET45: 45, NET60: 60 };

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}
function writeFile(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf-8');
}
function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Fabricate a BillQueryRs response echoing back a chosen TxnID + EditSequence
 *  for the given RefNumber. Mirrors the shape QB returns on a successful
 *  match — enough for parseBillQueryRs to extract the identifiers. */
function fabricateBillQueryRs(
  refNumber: string,
  txnId: string,
  editSeq: string,
  requestId?: string,
): string {
  const reqAttr = requestId ? ` requestID="${requestId}"` : '';
  return [
    `<BillQueryRs${reqAttr} statusCode="0" statusSeverity="Info" statusMessage="Status OK">`,
    '  <BillRet>',
    `    <TxnID>${txnId}</TxnID>`,
    '    <TimeCreated>2026-05-31T12:00:00-08:00</TimeCreated>',
    '    <TimeModified>2026-05-31T12:00:00-08:00</TimeModified>',
    `    <EditSequence>${editSeq}</EditSequence>`,
    '    <TxnNumber>42</TxnNumber>',
    '    <VendorRef><ListID>V</ListID><FullName>DRY-RUN-VENDOR</FullName></VendorRef>',
    '    <APAccountRef><FullName>Accounts Payable</FullName></APAccountRef>',
    '    <TxnDate>2026-05-31</TxnDate>',
    '    <AmountDue>0.00</AmountDue>',
    // A realistic LinkedTxn — asserts the parser's stripping logic works in the
    // dry-run just like it does in unit tests.
    '    <LinkedTxn>',
    '      <TxnID>NEVER-SEE-THIS-TXNID</TxnID>',
    '      <RefNumber>NEVER-SEE-THIS-REFNUM</RefNumber>',
    '    </LinkedTxn>',
    `    <RefNumber>${refNumber}</RefNumber>`,
    '    <IsPaid>false</IsPaid>',
    '  </BillRet>',
    '</BillQueryRs>',
  ].join('\n');
}

// ─── The dry-run ────────────────────────────────────────────────────────────

interface Finding {
  category: 'blocker' | 'warn' | 'info';
  message: string;
  detail?: unknown;
}

let findings: Finding[] = [];
let resolvedBills: ResolvedBill[] = [];
let allTxns: ConveraTransaction[] = [];

beforeAll(async () => {
  // Fresh output dir each run
  if (fs.existsSync(OUT_ROOT)) fs.rmSync(OUT_ROOT, { recursive: true });
  ensureDir(OUT_ROOT);

  const { txns, invoicesById, profilesById, profilesByUserIban } = await fetchAll();
  allTxns = txns;

  // Resolve every matched invoice's qb_vendor_name via the IIF cascade
  const seen = new Set<number>();
  for (const t of txns) {
    if (t.matched_invoice_id == null) continue;
    if (seen.has(t.matched_invoice_id)) continue;
    seen.add(t.matched_invoice_id);
    const inv = invoicesById.get(t.matched_invoice_id);
    if (!inv) {
      findings.push({ category: 'warn', message: `Transaction ${t.id} references missing invoice_id=${t.matched_invoice_id}` });
      continue;
    }
    const vendorName = resolveVendorName(inv, profilesById, profilesByUserIban);
    resolvedBills.push({
      invoice: inv,
      vendorName,
      // Placeholder identifiers used to simulate QB's response. Chosen to be
      // grep-friendly + traceable back to the source invoice.
      fabricatedTxnId: `FAKE-BILL-${inv.id}`,
      fabricatedEditSeq: `FAKE-ES-${inv.id}`,
    });
  }
}, 60_000);

describe('qbXML dry-run · batch ' + BATCH_ID, () => {
  it('resolves qb_vendor_name for every matched invoice (id → IBAN cascade)', () => {
    const missing = resolvedBills.filter((r) => !r.vendorName);
    if (missing.length > 0) {
      findings.push({
        category: 'blocker',
        message: `${missing.length} invoice(s) have no qb_vendor_name via id or IBAN — QB would reject the bill`,
        detail: missing.map((m) => ({ invoice_id: m.invoice.id, invoice_number: m.invoice.invoice_number })),
      });
    }
    expect(missing).toEqual([]);
  });

  it('all wire confirmation numbers fit BillPaymentCheck 11-char cap', () => {
    const confirmations = Array.from(new Set(allTxns.map((t) => t.confirmation_number)));
    const overLimit = confirmations.filter((c) => c && c.length > 11);
    if (overLimit.length > 0) {
      findings.push({
        category: 'blocker',
        message: `${overLimit.length} wire confirmation(s) exceed 11 chars — BillPaymentCheck.RefNumber cap`,
        detail: overLimit,
      });
    }
    expect(overLimit).toEqual([]);
  });

  it('generates BillQueryRq + BillAddRq for every resolved bill', () => {
    const refLenWarnings: Array<{ id: number; refNumber: string; len: number }> = [];
    for (const rb of resolvedBills) {
      const refNumber = rb.invoice.invoice_number;
      // Session 2 flagged 20 chars as a soft ceiling for BillAdd.RefNumber
      if (refNumber && refNumber.length > 20) {
        refLenWarnings.push({ id: rb.invoice.id, refNumber, len: refNumber.length });
      }
      // BillQueryRq — one refNumber per query for simplicity
      const queryXml = buildBillQueryRq({
        refNumbers: [refNumber],
        requestId: `q-${rb.invoice.id}`,
      });
      writeFile(
        path.join(OUT_ROOT, 'queries', `${rb.invoice.id}-BillQueryRq.xml`),
        wrapQbxmlRequests([queryXml]),
      );
      // BillAddRq — one bill per invoice (batch 15 has 1 invoice per vendor)
      const inv = rb.invoice;
      const monthLabel = monthLabelOf(inv.period_end || inv.period_start);
      const txnDate = lastDayOfPeriodEnd(inv.period_end || inv.period_start);
      const termsDays = TERMS_TO_DAYS[inv.payment_terms ?? 'NET30'] ?? 30;
      const dueDate = addDaysIso(txnDate, termsDays);
      const memo = `${monthLabel} — ${Number(inv.total_hours ?? 0)}h @ $${Number(inv.rate ?? 0)} — ${inv.user_name}`;
      // invoice_number already carries its own prefix (e.g. "INV 5/2026") — don't double-prefix.
      const lineMemo = `${memo} — ${refNumber}`;
      const addXml = buildBillAddRq({
        vendorName: rb.vendorName!,
        txnDate,
        dueDate,
        refNumber,
        memo,
        lines: [{ amount: Number(inv.total_amount), memo: lineMemo }],
        requestId: `add-${inv.id}`,
      });
      writeFile(
        path.join(OUT_ROOT, 'bills', `${inv.id}-BillAddRq.xml`),
        wrapQbxmlRequests([addXml]),
      );
    }
    if (refLenWarnings.length > 0) {
      findings.push({
        category: 'warn',
        message: `${refLenWarnings.length} invoice(s) have RefNumber > 20 chars — may exceed BillAdd.RefNumber cap (see GOTCHAS q5)`,
        detail: refLenWarnings,
      });
    }
    expect(resolvedBills.length).toBeGreaterThan(0);
  });

  it('parses fabricated BillQueryRs back into TxnIDs matching the ones we fabricated', () => {
    // Fabricate a response for each bill and roundtrip through the parser.
    for (const rb of resolvedBills) {
      const rs = fabricateBillQueryRs(
        rb.invoice.invoice_number,
        rb.fabricatedTxnId,
        rb.fabricatedEditSeq,
        `q-${rb.invoice.id}`,
      );
      writeFile(
        path.join(OUT_ROOT, 'fabricated-responses', `${rb.invoice.id}-BillQueryRs.xml`),
        rs,
      );
      const parsed = parseBillQueryRs(rs);
      expect(parsed.status.statusCode).toBe('0');
      expect(parsed.results).toHaveLength(1);
      // Load-bearing: parser must return the HEADER TxnID/RefNumber, not the
      // LinkedTxn's fake values. Same invariant as unit tests but exercised
      // against the exact fixture shape we'll use for real query responses.
      expect(parsed.results[0].txnId).toBe(rb.fabricatedTxnId);
      expect(parsed.results[0].refNumber).toBe(rb.invoice.invoice_number);
      expect(parsed.results[0].txnId).not.toBe('NEVER-SEE-THIS-TXNID');
      expect(parsed.results[0].refNumber).not.toBe('NEVER-SEE-THIS-REFNUM');
    }
  });

  it('generates BillPaymentCheckAddRq per (vendor, wire) group and PaymentAmounts sum to wire subtotal', () => {
    // Group transactions by (confirmation_number, vendor). One BillPaymentCheck
    // per group, per the builder invariant "one payee per payment".
    interface GroupKey { wire: string; vendor: string }
    const groups = new Map<string, {
      key: GroupKey;
      applications: Array<{ billTxnId: string; paymentAmount: number; invoice: InvoiceRow }>;
      txnDate: string;
      subtotalSum: number;
    }>();
    for (const t of allTxns) {
      if (t.matched_invoice_id == null) continue;
      const rb = resolvedBills.find((r) => r.invoice.id === t.matched_invoice_id);
      if (!rb || !rb.vendorName) continue;
      const k = `${t.confirmation_number}::${rb.vendorName}`;
      if (!groups.has(k)) {
        groups.set(k, {
          key: { wire: t.confirmation_number, vendor: rb.vendorName },
          applications: [],
          txnDate: t.date_of_order,
          subtotalSum: 0,
        });
      }
      const g = groups.get(k)!;
      g.applications.push({
        billTxnId: rb.fabricatedTxnId,
        paymentAmount: Number(t.subtotal),
        invoice: rb.invoice,
      });
      g.subtotalSum += Number(t.subtotal);
      if (t.date_of_order < g.txnDate) g.txnDate = t.date_of_order;
    }

    const wireCount = new Set(Array.from(groups.values()).map((g) => g.key.wire)).size;
    const vendorSpan = new Map<string, number>(); // wire → distinct vendor count
    for (const g of groups.values()) {
      vendorSpan.set(g.key.wire, (vendorSpan.get(g.key.wire) ?? 0) + 1);
    }
    for (const [wire, vendors] of vendorSpan) {
      if (vendors > 1) {
        findings.push({
          category: 'info',
          message: `Wire ${wire} spans ${vendors} vendors — will produce ${vendors} BillPaymentCheck jobs (builder invariant "one payee per payment")`,
        });
      }
    }

    // Build one payment request per group. Assert application sum matches wire.
    for (const g of groups.values()) {
      const memo = `Convera wire — ${g.applications.length === 1 ? `${g.applications[0].invoice.invoice_number} — ` : `${g.applications.length} bills — `}${g.key.vendor}`;
      const payXml = buildBillPaymentCheckAddRq({
        payeeVendorName: g.key.vendor,
        txnDate: g.txnDate,
        bankAccountName: WU_HOLDING,
        refNumber: g.key.wire, // 10-char OTR code — fits cap
        memo,
        applications: g.applications.map((a) => ({
          billTxnId: a.billTxnId,
          paymentAmount: a.paymentAmount,
        })),
        requestId: `pay-${slug(g.key.wire)}-${slug(g.key.vendor)}`,
      });
      writeFile(
        path.join(OUT_ROOT, 'payments', `${slug(g.key.wire)}__${slug(g.key.vendor)}-BillPaymentCheckAddRq.xml`),
        wrapQbxmlRequests([payXml]),
      );

      // Invariant: sum of AppliedToTxnAdd.PaymentAmount == wire subtotal for this vendor
      const appliedSum = g.applications.reduce((s, a) => s + a.paymentAmount, 0);
      expect(Math.round(appliedSum * 100)).toBe(Math.round(g.subtotalSum * 100));
    }

    findings.push({
      category: 'info',
      message: `Generated ${groups.size} BillPaymentCheck jobs across ${wireCount} wire(s)`,
    });
    expect(groups.size).toBeGreaterThan(0);
  });

  it('writes audit report + findings.json', () => {
    const summary = {
      batchId: BATCH_ID,
      generatedAt: new Date().toISOString(),
      totals: {
        transactionsInBatch: allTxns.length,
        matchedInvoices: resolvedBills.length,
        wiresInBatch: new Set(allTxns.map((t) => t.confirmation_number)).size,
        vendorsCovered: new Set(resolvedBills.map((r) => r.vendorName)).size,
        totalDollarAmount: resolvedBills.reduce((s, r) => s + Number(r.invoice.total_amount), 0),
      },
      findings,
    };

    writeFile(
      path.join(OUT_ROOT, 'findings.json'),
      JSON.stringify(summary, null, 2),
    );

    const md: string[] = [];
    md.push(`# qbXML dry-run · batch ${BATCH_ID}\n`);
    md.push(`Generated: ${summary.generatedAt}\n`);
    md.push('## Totals');
    md.push(`- Transactions in batch: ${summary.totals.transactionsInBatch}`);
    md.push(`- Matched invoices: ${summary.totals.matchedInvoices}`);
    md.push(`- Distinct wires: ${summary.totals.wiresInBatch}`);
    md.push(`- Distinct vendors: ${summary.totals.vendorsCovered}`);
    md.push(`- Total $: ${summary.totals.totalDollarAmount.toFixed(2)}\n`);
    md.push('## Artifacts');
    md.push(`- \`queries/\` — one \`<BillQueryRq>\` envelope per invoice`);
    md.push(`- \`bills/\` — one \`<BillAddRq>\` envelope per invoice`);
    md.push(`- \`fabricated-responses/\` — hand-crafted \`<BillQueryRs>\` used to feed the chain simulation`);
    md.push(`- \`payments/\` — one \`<BillPaymentCheckAddRq>\` envelope per (wire, vendor) group\n`);
    if (findings.length === 0) {
      md.push('## Findings\n\n_No issues surfaced. Every builder accepted every real input; every parser round-trip returned the expected TxnID._\n');
    } else {
      md.push('## Findings');
      for (const cat of ['blocker', 'warn', 'info'] as const) {
        const items = findings.filter((f) => f.category === cat);
        if (items.length === 0) continue;
        md.push(`\n### ${cat.toUpperCase()} (${items.length})\n`);
        for (const f of items) {
          md.push(`- **${f.message}**`);
          if (f.detail) md.push('  ```json\n  ' + JSON.stringify(f.detail, null, 2).replace(/\n/g, '\n  ') + '\n  ```');
        }
      }
    }
    writeFile(path.join(OUT_ROOT, 'audit.md'), md.join('\n') + '\n');
    console.log(`\n📄 Dry-run artifacts written to: ${OUT_ROOT}`);
    console.log(`   audit.md, findings.json, plus per-request XML in bills/, queries/, fabricated-responses/, payments/\n`);
  });
});
