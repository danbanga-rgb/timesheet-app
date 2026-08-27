// converaInvoiceCreateBill — G7.6 consumer of qbWrite executor.
//
// Scope (redesigned 2026-08-27 around invoices.group_key):
//   Proactively push create_bill for APPROVED Convera invoices that don't yet
//   have a Bill in QB. Groups by invoices.group_key first (the ingest-time
//   attachment-group used everywhere else in the app — Invoices tab, IIF
//   exporter, matcher). Falls back to (vendor, YYYY-MM) rollup only for
//   invoices that arrived independently (group_key = null).
//
// Why group_key first (2026-08-27 correction):
//   The Teal Crossroads case exposed a real gap. All 6 Teal contractors on a
//   single PDF share invoice_number + group_key, but individual snapshot
//   qb_vendor_name entries can be null (data-entry gaps like Iskra Kochova
//   whose live payment_profile.qb_vendor_name is unset). The (vendor,
//   YYYY-MM) grouping I built first:
//     (a) silently dropped Iskra
//     (b) would have emitted RefNumber = MULTI-YYYY-MM for the other 5, when
//         the accountant's manual convention (and the source PDF) uses the
//         shared invoice_number.
//   Grouping by group_key (with group-scope vendor resolution) fixes both.
//
// Vendor resolution for a group:
//   Consult ALL members. Prefer snapshot payment_profile.qbVendorName; fall
//   back to live payment_profiles.qb_vendor_name (default profile preferred).
//   Any member resolving pins the vendor for the whole group. If two members
//   disagree on non-empty vendor names, hold the group with a mismatch reason
//   (real data anomaly worth surfacing, not silently reconciling).
//
// RefNumber for a group:
//   All members share the same invoice_number → use it (single PDF case).
//   Members have distinct invoice_numbers → MULTI-YYYY-MM (independent invoices
//   that happen to share (vendor, month) via the fallback path).
//   Singleton group → invoice_number.
//
// Atomicity:
//   Group pushes are all-or-nothing. If ANY member fails eligibility (not
//   approved, wrong payment method, pre-cutoff, missing invoice_number, or
//   qb_bill_txn_id already set) the whole group is skipped with a reason
//   naming the failing member. A QB Bill cannot cover a partial group.
//
// Auto-expansion:
//   Callers can pass any subset of invoice ids; if any id has a group_key,
//   the consumer auto-pulls all siblings sharing that group_key. Prevents
//   half-selecting an umbrella from the modal.
//
// Per-invariant handling (see src/lib/qbWrite/INVARIANTS.md):
//   #14 payload contract, #18/#19 idempotency, #22 snapshot-vs-live, #27
//   fresh-fetch — all preserved.
//
// Extra guardrails:
//   Bimosoft UK ALT guardrail ([[bimosoft-uk-alt-rule]]) on resolved vendor.
//   Idempotency Layer 3: qb_mirror lookup for existing bill at (vendor, refNumber).
//     Applies to BOTH shared-invoice-number groups AND MULTI-YYYY-MM groups.

import type { SupabaseClient } from '@supabase/supabase-js';
import { CONVERA_PRE_OUR_SYSTEM_CUTOFF } from '../../convera/config';
import { executeIntents } from '../execute';
import type { CreateBillIntent, ExecuteResult } from '../types';

export interface ConveraInvoiceCreateBillResult extends ExecuteResult {
  /** Invoices skipped up-front — never reached the executor.
   *  For a group skip, EVERY member appears with the shared reason. */
  skippedIneligible: Array<{ invoiceId: number; reason: string }>;
  /** For each successful bill_add job, the chained bill_query verify job id. */
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
  group_key: string | null;
}

interface ProfileRow {
  id: string;
  name: string | null;
}

/** Format an invoice_number for memo output. Invoice numbers in our DB often
 *  already carry an "INV" or "Inv#" prefix ("INV 12", "Inv# 07"), sometimes
 *  don't ("12", "58"). Always prefix with "INV " but never double-prefix.
 *  Case-insensitive detection. Fixes 2026-08-27 memo bug ("INV INV 12"). */
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
interface MirrorBillRow {
  vendor_list_id: string;
  ref_number: string;
}

const INVOICE_COLUMNS = 'id, user_id, invoice_number, total_amount, period_end, status, payment_method, qb_bill_txn_id, payment_profile, group_key';

function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

function yyyyMm(iso: string): string {
  return iso.slice(0, 7);
}

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

  // ─── Fetch input invoices ───────────────────────────────────────────────
  const { data: inputData } = await supabase
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .in('id', invoiceIds);
  const inputInvoices = (inputData ?? []) as InvoiceRow[];
  const foundIds = new Set(inputInvoices.map(i => i.id));
  for (const id of invoiceIds) {
    if (!foundIds.has(id)) skippedIneligible.push({ invoiceId: id, reason: 'not found in invoices' });
  }

  // ─── Auto-expand by group_key ───────────────────────────────────────────
  // Any input invoice with a group_key pulls in ALL siblings sharing that key,
  // even if the caller didn't include them. A Bill cannot cover a partial
  // group, so pushing "Damjan" implicitly pushes the whole Teal PDF.
  const inputGroupKeys = [...new Set(
    inputInvoices.map(i => i.group_key).filter((k): k is string => !!k),
  )];
  const invoicesById = new Map(inputInvoices.map(i => [i.id, i]));
  if (inputGroupKeys.length > 0) {
    const { data: siblings } = await supabase
      .from('invoices')
      .select(INVOICE_COLUMNS)
      .in('group_key', inputGroupKeys);
    for (const sib of ((siblings ?? []) as InvoiceRow[])) {
      if (!invoicesById.has(sib.id)) invoicesById.set(sib.id, sib);
    }
  }
  const allInvoices = [...invoicesById.values()];

  // ─── Build groups ───────────────────────────────────────────────────────
  // Key: group_key when present, else synthetic single-invoice key.
  interface Group {
    key: string;
    isAttachmentGroup: boolean;
    members: InvoiceRow[];
  }
  const groupsByKey = new Map<string, Group>();
  for (const inv of allInvoices) {
    const key = inv.group_key ?? `__solo::${inv.id}`;
    let g = groupsByKey.get(key);
    if (!g) {
      g = { key, isAttachmentGroup: inv.group_key != null, members: [] };
      groupsByKey.set(key, g);
    }
    g.members.push(inv);
  }

  // ─── Load supporting tables (once) ──────────────────────────────────────
  const allUserIds = [...new Set(allInvoices.map(i => i.user_id))];
  const [liveProfilesRes, vendorRes, mappingRes, profileRes] = await Promise.all([
    supabase.from('payment_profiles').select('user_id, qb_vendor_name, is_default').in('user_id', allUserIds),
    supabase.from('qb_vendors').select('list_id, name'),
    supabase.from('qb_vendor_mappings').select('qb_vendor_list_id, default_expense_account_list_id'),
    supabase.from('profiles').select('id, name').in('id', allUserIds),
  ]);
  const liveProfiles = (liveProfilesRes.data ?? []) as PaymentProfileRow[];
  const vendors = (vendorRes.data ?? []) as VendorRow[];
  const mappings = (mappingRes.data ?? []) as MappingRow[];
  const profileByUserId = new Map(((profileRes.data ?? []) as ProfileRow[]).map(p => [p.id, p]));

  // Live vendor name per user_id (default profile wins; else first non-empty).
  const liveVendorByUser = new Map<string, string>();
  for (const pp of liveProfiles) {
    const name = pp.qb_vendor_name?.trim();
    if (!name) continue;
    if (!liveVendorByUser.has(pp.user_id) || pp.is_default) {
      liveVendorByUser.set(pp.user_id, name);
    }
  }
  const vendorByLowerName = new Map(vendors.map(v => [v.name.toLowerCase().trim(), v]));
  const mappingByVendorListId = new Map(mappings.map(m => [m.qb_vendor_list_id, m]));

  // ─── Per-group eligibility, vendor resolution, and intent build ────────
  interface ResolvedGroup {
    group: Group;
    vendor: VendorRow;
    expenseListId: string;
    refNumber: string;
    txnDate: string;
    yyyyMm: string;
  }
  const resolved: ResolvedGroup[] = [];
  const needsExpenseAccountLookup = new Set<string>();

  const groupSkip = (g: Group, reason: string) => {
    for (const m of g.members) skippedIneligible.push({ invoiceId: m.id, reason });
  };

  for (const g of groupsByKey.values()) {
    // ── Eligibility: all members must pass ──
    let eligibilityReason: string | null = null;
    for (const m of g.members) {
      if (m.status !== 'approved') { eligibilityReason = `group blocked: invoice ${m.id} (${profileByUserId.get(m.user_id)?.name ?? '?'}) status='${m.status}'`; break; }
      if (m.qb_bill_txn_id) { eligibilityReason = `group blocked: invoice ${m.id} (${profileByUserId.get(m.user_id)?.name ?? '?'}) already has qb_bill_txn_id=${m.qb_bill_txn_id}`; break; }
      if (m.payment_method !== 'Convera') { eligibilityReason = `group blocked: invoice ${m.id} (${profileByUserId.get(m.user_id)?.name ?? '?'}) payment_method='${m.payment_method ?? 'null'}'`; break; }
      if (!m.period_end || m.period_end < CONVERA_PRE_OUR_SYSTEM_CUTOFF) { eligibilityReason = `group blocked: invoice ${m.id} period_end=${m.period_end ?? 'null'} < cutoff ${CONVERA_PRE_OUR_SYSTEM_CUTOFF}`; break; }
      if (!m.invoice_number || !m.invoice_number.trim()) { eligibilityReason = `group blocked: invoice ${m.id} has empty invoice_number`; break; }
    }
    if (eligibilityReason) { groupSkip(g, eligibilityReason); continue; }

    // ── Vendor resolution across ALL members ──
    // Collect distinct non-empty candidates from snapshot first, then live.
    const candidates = new Set<string>();
    for (const m of g.members) {
      const snap = ((m.payment_profile ?? {}) as Record<string, unknown>).qbVendorName;
      const s = typeof snap === 'string' ? snap.trim() : '';
      if (s) candidates.add(s);
    }
    if (candidates.size === 0) {
      for (const m of g.members) {
        const live = liveVendorByUser.get(m.user_id);
        if (live) candidates.add(live);
      }
    }
    if (candidates.size === 0) {
      groupSkip(g, `group blocked: no qb_vendor_name on any member's payment_profile (snapshot or live). Set qbVendorName on at least one member's profile (Payments tab → Profiles → click "⚠ Not mapped").`);
      continue;
    }
    if (candidates.size > 1) {
      groupSkip(g, `group blocked: members resolve to different qb_vendor_names (${[...candidates].join(', ')}). Data anomaly — reconcile before pushing.`);
      continue;
    }
    const vendorName = [...candidates][0];

    // ── Bimosoft UK ALT guardrail ──
    if (isBimosoftNonUkAlt(vendorName)) {
      groupSkip(g, `Bimosoft guardrail: resolved qb_vendor_name="${vendorName}" is Bimosoft-flavored but not "UK ALT". All Bimosoft invoices must route through Bimosoft UK ALT (2026-08 money-loss incidents Amar 162 / Anela 180).`);
      continue;
    }

    // ── Vendor lookup ──
    const vendor = vendorByLowerName.get(vendorName.toLowerCase().trim());
    if (!vendor) {
      groupSkip(g, `qb_vendor "${vendorName}" not found in qb_vendors (sync qb_mirror)`);
      continue;
    }

    // ── Expense account mapping ──
    const mapping = mappingByVendorListId.get(vendor.list_id);
    const expenseListId = mapping?.default_expense_account_list_id;
    if (!expenseListId) {
      groupSkip(g, `qb_vendor_mappings for "${vendor.name}" has no default_expense_account_list_id — set it via Mappings UI (or run migration 20260827000000_g76_seed_convera_expense_defaults.sql).`);
      continue;
    }
    needsExpenseAccountLookup.add(expenseListId);

    // ── RefNumber decision ──
    // Members sharing invoice_number → use the shared number.
    // Members with distinct invoice_numbers → MULTI-YYYY-MM.
    const invoiceNumbers = new Set(g.members.map(m => m.invoice_number!.trim()));
    // Group txnDate = MAX(period_end) among members (end of billing month).
    const txnDate = g.members.map(m => m.period_end!).sort().slice(-1)[0]!;
    const ym = yyyyMm(txnDate);
    const refNumber = invoiceNumbers.size === 1
      ? [...invoiceNumbers][0]
      : `MULTI-${ym}`;

    resolved.push({ group: g, vendor, expenseListId, refNumber, txnDate, yyyyMm: ym });
  }

  if (resolved.length === 0) return emptyReturn();

  // ─── Expense account name lookup ────────────────────────────────────────
  const { data: expenseData } = await supabase
    .from('qb_accounts')
    .select('list_id, full_name')
    .in('list_id', Array.from(needsExpenseAccountLookup));
  const expenseNameByListId = new Map(((expenseData ?? []) as AccountRow[]).map(a => [a.list_id, a.full_name]));

  // ─── Idempotency Layer 3: qb_mirror bill lookup by (vendor, refNumber) ─
  // Applies uniformly to both shared-invoice-number groups AND MULTI groups.
  // The accountant may have created either shape manually via IIF.
  const idempotencyKeys = resolved.map(r => `${r.vendor.list_id}::${r.refNumber}`);
  if (idempotencyKeys.length > 0) {
    const { data: mirrorRows } = await supabase
      .from('qb_mirror')
      .select('vendor_list_id, ref_number')
      .eq('entity_kind', 'bill')
      .in('vendor_list_id', [...new Set(resolved.map(r => r.vendor.list_id))])
      .in('ref_number', [...new Set(resolved.map(r => r.refNumber))]);
    const existing = new Set(((mirrorRows ?? []) as MirrorBillRow[]).map(r => `${r.vendor_list_id}::${r.ref_number}`));
    for (let i = resolved.length - 1; i >= 0; i--) {
      const r = resolved[i];
      const key = `${r.vendor.list_id}::${r.refNumber}`;
      if (existing.has(key)) {
        groupSkip(r.group, `mirror idempotency: qb_mirror already has bill (${r.vendor.name}, ${r.refNumber}). Not pushing duplicate.`);
        resolved.splice(i, 1);
      }
    }
  }

  // ─── Build intents ──────────────────────────────────────────────────────
  const intents: CreateBillIntent[] = [];
  for (const r of resolved) {
    const expenseName = expenseNameByListId.get(r.expenseListId);
    if (!expenseName) {
      groupSkip(r.group, `qb_account "${r.expenseListId}" not found in qb_accounts (sync qb_mirror)`);
      continue;
    }
    const monthLabel = fmtMonth(r.txnDate);
    // Sort members by user name for stable line ordering.
    const sortedMembers = [...r.group.members].sort((a, b) => {
      const na = profileByUserId.get(a.user_id)?.name ?? '';
      const nb = profileByUserId.get(b.user_id)?.name ?? '';
      return na.localeCompare(nb);
    });
    // Bill-level memo: for singleton use per-invoice memo; for group summarise.
    const billMemo = sortedMembers.length === 1
      ? `${monthLabel} - ${profileByUserId.get(sortedMembers[0].user_id)?.name ?? ''} - ${memoRef(sortedMembers[0].invoice_number!)}`.trim()
      : `${monthLabel} - ${r.vendor.name} - ${r.refNumber} (${sortedMembers.length} lines)`;
    intents.push({
      kind: 'create_bill',
      auditTag,
      vendorName: r.vendor.name,
      refNumber: r.refNumber,
      txnDate: r.txnDate,
      memo: billMemo,
      defaultExpenseAccountName: expenseName,
      lines: sortedMembers.map(m => ({
        amount: Number(m.total_amount),
        memo: `${monthLabel} - ${profileByUserId.get(m.user_id)?.name ?? ''} - ${memoRef(m.invoice_number!)}`.trim(),
        expenseAccountName: expenseName,
      })),
      sourceInvoiceIds: sortedMembers.map(m => m.id),
    });
  }

  if (intents.length === 0) return emptyReturn();

  const result = await executeIntents(supabase, intents);

  // Chain bill_query verify (INVARIANT #36) — same pattern as G7.5.
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
