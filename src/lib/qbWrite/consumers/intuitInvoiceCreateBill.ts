// intuitInvoiceCreateBill — G7.5 consumer of qbWrite executor.
//
// Scope (locked with Dan 2026-08-26):
//   Proactively push create_bill for APPROVED Intuit invoices that don't
//   yet have a corresponding Bill in QB (per Missing QB Bills audit). One
//   Bill per invoice, RefNumber = invoice_number. Removes the reactive
//   create_bill_then_pay chain from the payment-ingest path for the common
//   Case A vendors — by the time the Intuit payment ingest event arrives,
//   the Bill already exists and the reconciler routes to pay_existing_bill.
//
// Scope excludes (deferred):
//   - Convera invoices → G7.6 will retire IIF/MULTI grouping for those
//   - paymentMethod not Intuit or empty
//   - period_end < INTUIT_PRE_OUR_SYSTEM_CUTOFF (belt + suspenders)
//
// Per-invariant handling (see src/lib/qbWrite/INVARIANTS.md):
//   #14 — Payload contract: executor validates; consumer supplies sourceInvoiceIds
//   #18/#19 — Idempotency: executor skips if invoices.qb_bill_txn_id is set,
//         or if a pending/in_flight bill_add references any of these invoice ids
//   #22 — Snapshot vs live: invoice.paymentProfile is a JSONB SNAPSHOT taken
//         at invoice creation. Vendor name resolution ALWAYS falls back to the
//         live payment_profiles row by userId. Same class of bug bit F.5
//         classifier (4e1c7da) and Missing-QB-Bills audit (9482b75).
//   #27 — Fresh fetch: consumer reads invoices + payment_profiles + qb_vendors
//         + qb_vendor_mappings freshly from Supabase, not React state.
//
// Bill construction:
//   vendorName      = resolved (snapshot → live fallback)
//   refNumber       = invoice_number
//   txnDate         = invoice.period_end (accountant convention — bill dates
//                     align with the work period, not approval time)
//   memo            = `${MMM YYYY} - ${userName} - INV ${invoiceNumber}` — mirrors
//                     the accountant's manual memo style captured by the G7.5
//                     probe on job 625 (2026-08-26)
//   lines           = [{ amount: totalAmount, memo: <same>, expenseAccountName:
//                     <from qb_vendor_mappings.default_expense_account_list_id> }]
//   sourceInvoiceIds = [invoice.id]  → drain handler writes invoices.qb_bill_txn_id
//                     (existing branch at supabase/functions/qb-web-connector/index.ts:430)

import type { SupabaseClient } from '@supabase/supabase-js';
import { INTUIT_PRE_OUR_SYSTEM_CUTOFF } from '../../intuit/config';
import { executeIntents } from '../execute';
import type { CreateBillIntent, ExecuteResult } from '../types';

export interface IntuitInvoiceCreateBillResult extends ExecuteResult {
  /** Invoices skipped up-front — never reached the executor. */
  skippedIneligible: Array<{ invoiceId: number; reason: string }>;
  /** For each successful bill_add job, the chained bill_query verify job id
   *  (mirror-refresh — parallels INVARIANT #36 verify pattern used by intuitPush
   *  + intuitCreateBill G7b). qb_mirror gains the new bill on next QBWC drain,
   *  which the Missing QB Bills panel + reconciler both depend on. */
  verifyJobIdByBillAddJobId: Record<number, number>;
}

interface InvoiceRow {
  id: number;
  user_id: string;
  invoice_number: string | null;
  total_amount: number | string;
  period_end: string | null;
  status: string;
  payment_method: string | null;
  qb_bill_txn_id: string | null;
  payment_profile: Record<string, unknown> | null;
}

interface ProfileRow {
  id: string;
  name: string | null;
}

/** Format an invoice_number for memo output. See converaInvoiceCreateBill for
 *  the original rationale — invoice numbers often already carry an "INV" or
 *  "Inv#" prefix; don't double-prefix. Fixes 2026-08-27. */
function memoRef(invoiceNumber: string): string {
  const trimmed = invoiceNumber.trim();
  if (/^inv/i.test(trimmed)) return trimmed;
  return `INV ${trimmed}`;
}

interface PaymentProfileRow {
  user_id: string;
  qb_vendor_name: string | null;
  is_default: boolean | null;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }
interface MappingRow {
  qb_vendor_list_id: string;
  default_expense_account_list_id: string | null;
}

/** MM YYYY (e.g. "Jun 2026") from an ISO date string. */
function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export async function pushIntuitInvoiceCreateBill(
  supabase: SupabaseClient,
  invoiceIds: number[],
  opts: { auditTag?: string } = {},
): Promise<IntuitInvoiceCreateBillResult> {
  const auditTag = opts.auditTag ?? `intuit-invoice-create-bill-${new Date().toISOString().slice(0, 10)}`;
  const skippedIneligible: IntuitInvoiceCreateBillResult['skippedIneligible'] = [];
  const verifyJobIdByBillAddJobId: Record<number, number> = {};
  const emptyReturn = (): IntuitInvoiceCreateBillResult => ({
    jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible, verifyJobIdByBillAddJobId,
  });
  if (invoiceIds.length === 0) return emptyReturn();

  // ─── Fetch invoices ─────────────────────────────────────────────────────
  const { data: invoiceData } = await supabase
    .from('invoices')
    .select('id, user_id, invoice_number, total_amount, period_end, status, payment_method, qb_bill_txn_id, payment_profile')
    .in('id', invoiceIds);
  const invoices = (invoiceData ?? []) as InvoiceRow[];
  const foundIds = new Set(invoices.map(i => i.id));
  for (const id of invoiceIds) {
    if (!foundIds.has(id)) skippedIneligible.push({ invoiceId: id, reason: 'not found in invoices' });
  }

  // ─── Eligibility filter ─────────────────────────────────────────────────
  const eligible: InvoiceRow[] = [];
  for (const inv of invoices) {
    if (inv.status !== 'approved') {
      skippedIneligible.push({ invoiceId: inv.id, reason: `status='${inv.status}' — must be 'approved'` });
      continue;
    }
    if (inv.qb_bill_txn_id) {
      skippedIneligible.push({ invoiceId: inv.id, reason: `qb_bill_txn_id already set (${inv.qb_bill_txn_id}) — Bill exists in QB` });
      continue;
    }
    if (inv.payment_method !== 'Intuit') {
      skippedIneligible.push({ invoiceId: inv.id, reason: `payment_method='${inv.payment_method ?? 'null'}' — G7.5 handles Intuit only (Convera in G7.6)` });
      continue;
    }
    if (!inv.period_end || inv.period_end < INTUIT_PRE_OUR_SYSTEM_CUTOFF) {
      skippedIneligible.push({ invoiceId: inv.id, reason: `period_end=${inv.period_end ?? 'null'} < cutoff ${INTUIT_PRE_OUR_SYSTEM_CUTOFF} — pre-our-system` });
      continue;
    }
    if (!inv.invoice_number || !inv.invoice_number.trim()) {
      skippedIneligible.push({ invoiceId: inv.id, reason: 'invoice_number is empty — required as Bill RefNumber' });
      continue;
    }
    eligible.push(inv);
  }
  if (eligible.length === 0) return emptyReturn();

  // ─── Vendor resolution: snapshot → live fallback (INVARIANT #22) ────────
  const userIds = Array.from(new Set(eligible.map(i => i.user_id)));
  const { data: liveProfilesData } = await supabase
    .from('payment_profiles')
    .select('user_id, qb_vendor_name, is_default')
    .in('user_id', userIds);
  const liveProfiles = (liveProfilesData ?? []) as PaymentProfileRow[];
  const liveVendorByUser = new Map<string, string>();
  for (const pp of liveProfiles) {
    const name = pp.qb_vendor_name?.trim();
    if (!name) continue;
    if (!liveVendorByUser.has(pp.user_id) || pp.is_default) {
      liveVendorByUser.set(pp.user_id, name);
    }
  }
  const resolvedVendorName = (inv: InvoiceRow): string | null => {
    const snap = ((inv.payment_profile ?? {}) as Record<string, unknown>).qbVendorName;
    const snapshot = typeof snap === 'string' ? snap.trim() : '';
    if (snapshot) return snapshot;
    return liveVendorByUser.get(inv.user_id) ?? null;
  };

  // ─── Load supporting tables ─────────────────────────────────────────────
  const { data: vendorData } = await supabase.from('qb_vendors').select('list_id, name');
  const vendors = (vendorData ?? []) as VendorRow[];
  const vendorByLowerName = new Map(vendors.map(v => [v.name.toLowerCase().trim(), v]));

  const { data: mappingData } = await supabase
    .from('qb_vendor_mappings')
    .select('qb_vendor_list_id, default_expense_account_list_id');
  const mappings = (mappingData ?? []) as MappingRow[];
  const mappingByVendorListId = new Map(mappings.map(m => [m.qb_vendor_list_id, m]));

  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, name')
    .in('id', userIds);
  const profileByUserId = new Map(((profileData ?? []) as ProfileRow[]).map(p => [p.id, p]));

  // ─── Build intents ──────────────────────────────────────────────────────
  const intents: CreateBillIntent[] = [];
  const needsExpenseAccountLookup = new Set<string>();
  const perIntentVendor: Array<{ invoiceId: number; vendorListId: string; expenseListId: string }> = [];

  for (const inv of eligible) {
    const vendorName = resolvedVendorName(inv);
    if (!vendorName) {
      skippedIneligible.push({ invoiceId: inv.id, reason: 'no qb_vendor_name — snapshot + live payment_profiles both empty (set qbVendorName on the profile)' });
      continue;
    }
    const vendor = vendorByLowerName.get(vendorName.toLowerCase().trim());
    if (!vendor) {
      skippedIneligible.push({ invoiceId: inv.id, reason: `qb_vendor "${vendorName}" not found in qb_vendors (sync qb_mirror)` });
      continue;
    }
    const mapping = mappingByVendorListId.get(vendor.list_id);
    const expenseListId = mapping?.default_expense_account_list_id;
    if (!expenseListId) {
      skippedIneligible.push({ invoiceId: inv.id, reason: `qb_vendor_mappings for "${vendor.name}" has no default_expense_account_list_id — set it via Mappings UI first` });
      continue;
    }
    needsExpenseAccountLookup.add(expenseListId);
    perIntentVendor.push({ invoiceId: inv.id, vendorListId: vendor.list_id, expenseListId });
  }

  if (perIntentVendor.length === 0) return emptyReturn();

  // Resolve expense account list_id → full_name (executor sends by FullName)
  const { data: expenseData } = await supabase
    .from('qb_accounts')
    .select('list_id, full_name')
    .in('list_id', Array.from(needsExpenseAccountLookup));
  const expenseNameByListId = new Map(((expenseData ?? []) as AccountRow[]).map(a => [a.list_id, a.full_name]));

  for (const p of perIntentVendor) {
    const inv = eligible.find(i => i.id === p.invoiceId)!;
    const vendor = vendors.find(v => v.list_id === p.vendorListId)!;
    const expenseName = expenseNameByListId.get(p.expenseListId);
    if (!expenseName) {
      skippedIneligible.push({ invoiceId: inv.id, reason: `qb_account "${p.expenseListId}" not found in qb_accounts (sync qb_mirror)` });
      continue;
    }
    const userName = profileByUserId.get(inv.user_id)?.name ?? '';
    const monthLabel = fmtMonth(inv.period_end!);
    const memo = `${monthLabel} - ${userName} - ${memoRef(inv.invoice_number!)}`.trim();
    intents.push({
      kind: 'create_bill',
      auditTag,
      vendorName: vendor.name,
      refNumber: inv.invoice_number!.trim(),
      txnDate: inv.period_end!,
      memo,
      defaultExpenseAccountName: expenseName,
      lines: [{
        amount: Number(inv.total_amount),
        memo,
        expenseAccountName: expenseName,
      }],
      sourceInvoiceIds: [inv.id],
    });
  }

  if (intents.length === 0) return emptyReturn();

  const result = await executeIntents(supabase, intents);

  // Chain bill_query verify (INVARIANT #36) per successful bill_add so
  // qb_mirror refreshes with the new Bill on the next QBWC drain. Without this,
  // the Missing QB Bills panel keeps showing pushed invoices as "missing" until
  // the hourly pg_cron delta bill_query happens to catch these TxnIDs.
  //
  // Same hydrate marker pattern as G7b intuitCreateBill.ts:249. The bill_query
  // TxnID is hydrated from the parent bill_add's response at drain time.
  const verifyRows: Array<{ kind: 'bill_query'; payload: Record<string, unknown>; status: 'pending'; depends_on: number[] }> = [];
  const verifyMeta: Array<{ billAddJobId: number }> = [];
  result.jobIds.forEach((billAddJobId) => {
    if (billAddJobId == null) return;
    verifyRows.push({
      kind: 'bill_query',
      payload: {
        txnIds: [null],
        __hydrate_bill_txn_id_from_dep: billAddJobId,
        __audit_tag: `${auditTag}-verify`,
      },
      status: 'pending',
      depends_on: [billAddJobId],
    });
    verifyMeta.push({ billAddJobId });
  });
  if (verifyRows.length > 0) {
    const { data: insertedVerify } = await supabase
      .from('qb_sync_jobs')
      .insert(verifyRows)
      .select('id');
    if (insertedVerify) {
      (insertedVerify as Array<{ id: number }>).forEach((row, idx) => {
        verifyJobIdByBillAddJobId[verifyMeta[idx].billAddJobId] = row.id;
      });
    }
  }

  return { ...result, skippedIneligible, verifyJobIdByBillAddJobId };
}
