// converaInvoiceCreateBill — G7.6 consumer of qbWrite executor.
//
// Scope (settled 2026-08-26, executed 2026-08-27):
//   Proactively push create_bill for APPROVED Convera invoices that don't
//   yet have a corresponding Bill in QB. Groups invoices by (vendor, YYYY-MM):
//     N=1 → RefNumber = invoice_number (per-invoice bill)
//     N>1 → RefNumber = MULTI-YYYY-MM   (umbrella / month-rollup bill)
//   Mirrors the accountant's IIF grouping convention codified in
//   [[qb-bill-grouping]] so a proactive push is byte-for-byte equivalent to
//   the manual IIF import.
//
// Scope excludes (deferred):
//   - Intuit invoices → G7.5 handles those (intuitInvoiceCreateBill)
//   - Payment side entirely — Convera retrofit W2/W3 covers 3-account bank
//     split + umbrella N-per-1 fanout + fee allocation (see [[convera-retrofit-reality]])
//   - Bimosoft non-UK-ALT profiles (per [[bimosoft-uk-alt-rule]])
//   - period_end < CONVERA_PRE_OUR_SYSTEM_CUTOFF
//
// Per-invariant handling (see src/lib/qbWrite/INVARIANTS.md):
//   #14 — Payload contract: executor validates; consumer supplies sourceInvoiceIds
//   #18/#19 — Idempotency: executor skips if ANY invoice in the group has
//         qb_bill_txn_id set, or a pending/in_flight bill_add already
//         references any of these invoice ids
//   #22 — Snapshot vs live: invoice.paymentProfile is a JSONB SNAPSHOT taken
//         at invoice creation. Vendor name resolution ALWAYS falls back to the
//         live payment_profiles row by userId.
//   #27 — Fresh fetch: consumer reads invoices + payment_profiles + qb_vendors
//         + qb_vendor_mappings + qb_mirror freshly from Supabase, not React state.
//
// Extra guardrails (G7.6-specific):
//   Bimosoft UK ALT rule ([[bimosoft-uk-alt-rule]]): any invoice resolving
//     to a Bimosoft-flavored qb_vendor_name that isn't "UK ALT" is skipped
//     with a hold reason. Prevents recurrence of the 2026-08 money-loss
//     incidents (Amar 162, Anela 180).
//   MULTI idempotency (Layer 3): before emitting a MULTI intent, check
//     qb_mirror for an existing MULTI-YYYY-MM bill for that vendor. If
//     present, the accountant already created it (typically via IIF) —
//     skip to avoid duplicating.
//
// Bill construction (single-invoice case):
//   vendorName      = resolved (snapshot → live fallback)
//   refNumber       = invoice_number
//   txnDate         = invoice.period_end
//   memo            = `${MMM YYYY} - ${userName} - INV ${invoiceNumber}` — mirrors G7.5
//   lines           = [{ amount: totalAmount, memo, expenseAccountName }]
//   sourceInvoiceIds = [invoice.id]
//
// Bill construction (MULTI case, N > 1):
//   vendorName      = resolved
//   refNumber       = MULTI-YYYY-MM
//   txnDate         = MAX(period_end) across the group (end of billing month)
//   memo            = `${MMM YYYY} - ${userName} - MULTI (${N} invoices)`
//   lines           = one per invoice in the group (preserves per-invoice memo trail)
//   sourceInvoiceIds = [invoice.id, ...] all N

import type { SupabaseClient } from '@supabase/supabase-js';
import { CONVERA_PRE_OUR_SYSTEM_CUTOFF } from '../../convera/config';
import { executeIntents } from '../execute';
import type { CreateBillIntent, ExecuteResult } from '../types';

export interface ConveraInvoiceCreateBillResult extends ExecuteResult {
  /** Invoices skipped up-front — never reached the executor. */
  skippedIneligible: Array<{ invoiceId: number; reason: string }>;
  /** For each successful bill_add job, the chained bill_query verify job id
   *  (mirror refresh — same pattern as G7.5). */
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
  full_name: string | null;
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
interface MirrorBillRow {
  vendor_list_id: string;
  ref_number: string;
}

function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

/** YYYY-MM from an ISO date string. */
function yyyyMm(iso: string): string {
  return iso.slice(0, 7);
}

/** True if the resolved qb_vendor_name looks Bimosoft-flavored but is NOT
 *  the UK ALT canonical vendor. [[bimosoft-uk-alt-rule]] */
function isBimosoftNonUkAlt(vendorName: string): boolean {
  const n = vendorName.toLowerCase();
  if (!n.includes('bimosoft')) return false;
  return !n.includes('uk alt');
}

export async function pushConveraInvoiceCreateBill(
  supabase: SupabaseClient,
  invoiceIds: number[],
  opts: { auditTag?: string } = {},
): Promise<ConveraInvoiceCreateBillResult> {
  const auditTag = opts.auditTag ?? `convera-invoice-create-bill-${new Date().toISOString().slice(0, 10)}`;
  const skippedIneligible: ConveraInvoiceCreateBillResult['skippedIneligible'] = [];
  const verifyJobIdByBillAddJobId: Record<number, number> = {};
  const emptyReturn = (): ConveraInvoiceCreateBillResult => ({
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
    if (inv.payment_method !== 'Convera') {
      skippedIneligible.push({ invoiceId: inv.id, reason: `payment_method='${inv.payment_method ?? 'null'}' — G7.6 handles Convera only (Intuit in G7.5)` });
      continue;
    }
    if (!inv.period_end || inv.period_end < CONVERA_PRE_OUR_SYSTEM_CUTOFF) {
      skippedIneligible.push({ invoiceId: inv.id, reason: `period_end=${inv.period_end ?? 'null'} < cutoff ${CONVERA_PRE_OUR_SYSTEM_CUTOFF} — pre-our-system` });
      continue;
    }
    if (!inv.invoice_number || !inv.invoice_number.trim()) {
      skippedIneligible.push({ invoiceId: inv.id, reason: 'invoice_number is empty — required as Bill RefNumber (or as part of MULTI group)' });
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
    .select('id, full_name')
    .in('id', userIds);
  const profileByUserId = new Map(((profileData ?? []) as ProfileRow[]).map(p => [p.id, p]));

  // ─── Per-invoice vendor/expense resolution + Bimosoft guardrail ─────────
  interface Resolved {
    invoice: InvoiceRow;
    vendor: VendorRow;
    expenseListId: string;
  }
  const resolved: Resolved[] = [];
  const needsExpenseAccountLookup = new Set<string>();

  for (const inv of eligible) {
    const vendorName = resolvedVendorName(inv);
    if (!vendorName) {
      skippedIneligible.push({ invoiceId: inv.id, reason: 'no qb_vendor_name — snapshot + live payment_profiles both empty (set qbVendorName on the profile)' });
      continue;
    }
    // Slice 3 — Bimosoft UK ALT guardrail.
    if (isBimosoftNonUkAlt(vendorName)) {
      skippedIneligible.push({ invoiceId: inv.id, reason: `Bimosoft guardrail: qb_vendor_name="${vendorName}" is Bimosoft-flavored but not "UK ALT". All Bimosoft invoices must route through Bimosoft UK ALT per bimosoft-uk-alt-rule (2026-08 money-loss incidents Amar 162 / Anela 180).` });
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
    resolved.push({ invoice: inv, vendor, expenseListId });
  }
  if (resolved.length === 0) return emptyReturn();

  // Resolve expense account list_id → full_name
  const { data: expenseData } = await supabase
    .from('qb_accounts')
    .select('list_id, full_name')
    .in('list_id', Array.from(needsExpenseAccountLookup));
  const expenseNameByListId = new Map(((expenseData ?? []) as AccountRow[]).map(a => [a.list_id, a.full_name]));

  // ─── Group by (vendorListId, YYYY-MM) ───────────────────────────────────
  // Same convention as IIF exporter (see [[qb-bill-grouping]]).
  interface Group {
    vendor: VendorRow;
    expenseListId: string;
    yyyyMm: string;
    invoices: InvoiceRow[];
  }
  const groupKey = (vendorListId: string, ym: string) => `${vendorListId}::${ym}`;
  const groupByKey = new Map<string, Group>();
  for (const r of resolved) {
    const ym = yyyyMm(r.invoice.period_end!);
    const key = groupKey(r.vendor.list_id, ym);
    let g = groupByKey.get(key);
    if (!g) {
      g = { vendor: r.vendor, expenseListId: r.expenseListId, yyyyMm: ym, invoices: [] };
      groupByKey.set(key, g);
    }
    g.invoices.push(r.invoice);
  }

  // ─── Slice 3.5 — MULTI idempotency (Layer 3): skip groups where a
  // MULTI-YYYY-MM bill already exists in qb_mirror for this vendor.
  // Accountant may have created it via IIF pre-G7.6; do not duplicate.
  const multiGroups = Array.from(groupByKey.values()).filter(g => g.invoices.length > 1);
  const multiRefNumbers = multiGroups.map(g => `MULTI-${g.yyyyMm}`);
  const multiVendorListIds = [...new Set(multiGroups.map(g => g.vendor.list_id))];
  if (multiRefNumbers.length > 0) {
    const { data: mirrorRows } = await supabase
      .from('qb_mirror')
      .select('vendor_list_id, ref_number')
      .eq('entity_kind', 'bill')
      .in('vendor_list_id', multiVendorListIds)
      .in('ref_number', multiRefNumbers);
    const existing = new Set(((mirrorRows ?? []) as MirrorBillRow[]).map(r => `${r.vendor_list_id}::${r.ref_number}`));
    for (const g of multiGroups) {
      const key = `${g.vendor.list_id}::MULTI-${g.yyyyMm}`;
      if (existing.has(key)) {
        for (const inv of g.invoices) {
          skippedIneligible.push({ invoiceId: inv.id, reason: `MULTI idempotency: qb_mirror already has bill MULTI-${g.yyyyMm} for vendor "${g.vendor.name}" (accountant likely created via IIF). Not pushing duplicate.` });
        }
        groupByKey.delete(groupKey(g.vendor.list_id, g.yyyyMm));
      }
    }
  }

  // ─── Build intents ──────────────────────────────────────────────────────
  const intents: CreateBillIntent[] = [];
  for (const g of groupByKey.values()) {
    const expenseName = expenseNameByListId.get(g.expenseListId);
    if (!expenseName) {
      for (const inv of g.invoices) {
        skippedIneligible.push({ invoiceId: inv.id, reason: `qb_account "${g.expenseListId}" not found in qb_accounts (sync qb_mirror)` });
      }
      continue;
    }
    // Group txnDate = MAX(period_end) — end of the billing month.
    const groupTxnDate = g.invoices.map(i => i.period_end!).sort().slice(-1)[0]!;
    const monthLabel = fmtMonth(groupTxnDate);
    const userId = g.invoices[0].user_id;   // MULTI groups share vendor → share userId
    const userName = profileByUserId.get(userId)?.full_name ?? '';
    if (g.invoices.length === 1) {
      const inv = g.invoices[0];
      const memo = `${monthLabel} - ${userName} - INV ${inv.invoice_number}`.trim();
      intents.push({
        kind: 'create_bill',
        auditTag,
        vendorName: g.vendor.name,
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
    } else {
      const refNumber = `MULTI-${g.yyyyMm}`;
      const groupMemo = `${monthLabel} - ${userName} - MULTI (${g.invoices.length} invoices)`;
      intents.push({
        kind: 'create_bill',
        auditTag,
        vendorName: g.vendor.name,
        refNumber,
        txnDate: groupTxnDate,
        memo: groupMemo,
        defaultExpenseAccountName: expenseName,
        lines: g.invoices.map(inv => ({
          amount: Number(inv.total_amount),
          memo: `${monthLabel} - ${userName} - INV ${inv.invoice_number}`.trim(),
          expenseAccountName: expenseName,
        })),
        sourceInvoiceIds: g.invoices.map(i => i.id),
      });
    }
  }

  if (intents.length === 0) return emptyReturn();

  const result = await executeIntents(supabase, intents);

  // Chain bill_query verify (INVARIANT #36) per successful bill_add.
  // Mirror the G7.5 pattern (see intuitInvoiceCreateBill.ts:256).
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
