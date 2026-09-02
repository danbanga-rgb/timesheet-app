// converaCreateBillAndPay — Slice C-2/C-3 consumer for the Convera pay path.
//
// Handles the "bill doesn't exist in QB yet" case for Convera events. Fans
// per-vendor so multi-vendor umbrella wires (Bimosoft: one wire, N vendors)
// emit N pay chains, each linking sourceConveraTxnId. Same-vendor multi-
// invoice missing-bill sub-groups use the multi-slot hydration mechanism
// (qb-web-connector's __hydrate_from_deps in the bill_add persist branch).
//
// Per-vendor sub-group flow:
//   1. Collect all invoices in this event that resolve to this vendor.
//   2. Split into `existing` (invoice.qb_bill_txn_id set) + `missing` (needs create).
//   3. Enqueue create_bill for each missing invoice (delegating to
//      pushConveraInvoiceCreateBill so the group_key + ASCII + expense-account
//      logic stays in one place).
//   4. Emit ONE bill_pmt_add with N applications:
//        - existing bills: billTxnId already known, no hydration slot
//        - missing bills: billTxnId=null, __hydrate_from_deps entry for
//          {depJobId: <this-bill-add-id>, applicationIndex: <slot>}
//   5. depends_on = [all bill_add job ids for this sub-group]
//   6. Chain verify bill_query on the pay job (single-slot hydration for the
//      first missing bill's TxnID as a smoke-test; multi-bill verify is done
//      via the mirror snapshot after all bills drain).
//
// Battle-tested precedent: scripts/one-off/qb-batch-enqueue-payments.cjs
// (2026-08-14+) implements the multi-vendor fan for existing-bills case.
// This consumer generalises that pattern to include missing-bills chaining,
// and moves it from an offline script into the UI push flow.

import type { SupabaseClient } from '@supabase/supabase-js';
import { pushConveraInvoiceCreateBill } from './converaInvoiceCreateBill';
import { resolveInvoiceQbVendorName, extractSnapPpId, type ResolverPaymentProfile } from '../../vendorResolution';
import type { ExecuteResult } from '../types';

export interface ConveraCreateBillAndPayResult extends ExecuteResult {
  skippedIneligible: Array<{ eventId: number; reason: string }>;
  /** bill_add job ids enqueued via the delegated create_bill consumer. */
  billAddJobIds: number[];
  /** bill_pmt_add job ids chained on top. May be > eligible events (one per vendor sub-group). */
  chainedPayJobIds: number[];
  /** bill_query verify job ids keyed by the pay job id that spawned them. */
  verifyJobIdByPayJobId: Record<number, number>;
}

interface IngestEventRow {
  id: number;
  source: string;
  amount: number | string;
  counterparty_qb_vendor_list_id: string | null;
  status: string;
  target_qb_txn_kind: string | null;
  matched_invoice_ids: number[] | null;
  raw_data: { convera_transaction_id?: number } | null;
}

interface InvoiceRow {
  id: number;
  user_id: string;
  qb_bill_txn_id: string | null;
  total_amount: number | string;
  invoice_number: string | null;
  payment_profile: Record<string, unknown> | null;
}

interface ConveraTxnRow {
  id: number;
  confirmation_number: string;
  date_of_order: string | null;
}

interface UmbrellaLinkRow {
  transaction_id: number;
  invoice_id: number;
  amount_share: number | string | null;
}

interface PaymentProfileRow {
  id: number;
  user_id: string;
  qb_vendor_name: string | null;
  is_default: boolean | null;
  company_name: string | null;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }

const CONVERA_BANK_PATTERN = 'western union holding';

function findConveraBank(accounts: AccountRow[]): AccountRow | null {
  const target = CONVERA_BANK_PATTERN.toLowerCase();
  return accounts.find(a => a.full_name.toLowerCase().includes(target)) ?? null;
}

export async function pushConveraCreateBillAndPay(
  supabase: SupabaseClient,
  eventIds: number[],
  opts: { auditTag?: string } = {},
): Promise<ConveraCreateBillAndPayResult> {
  const auditTag = opts.auditTag
    ?? `convera-create-and-pay-${new Date().toISOString().slice(0, 10)}`;
  const skippedIneligible: ConveraCreateBillAndPayResult['skippedIneligible'] = [];
  const emptyReturn = (): ConveraCreateBillAndPayResult => ({
    jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible,
    billAddJobIds: [], chainedPayJobIds: [], verifyJobIdByPayJobId: {},
  });

  if (eventIds.length === 0) return emptyReturn();

  // ─── Fetch events + first-pass qualify ──────────────────────────────────
  const { data: eventData } = await supabase
    .from('qb_ingest_events')
    .select('id, source, amount, counterparty_qb_vendor_list_id, status, target_qb_txn_kind, matched_invoice_ids, raw_data')
    .in('id', eventIds);
  const events = (eventData ?? []) as IngestEventRow[];

  const foundIds = new Set(events.map(e => e.id));
  for (const id of eventIds) {
    if (!foundIds.has(id)) skippedIneligible.push({ eventId: id, reason: 'not found in qb_ingest_events' });
  }

  const eligible: IngestEventRow[] = [];
  for (const e of events) {
    if (e.source !== 'convera') { skippedIneligible.push({ eventId: e.id, reason: `source='${e.source}' — pushConveraCreateBillAndPay handles source='convera' only` }); continue; }
    if (e.status === 'posted') { skippedIneligible.push({ eventId: e.id, reason: `status='posted' — already pushed` }); continue; }
    if (e.status !== 'ready') { skippedIneligible.push({ eventId: e.id, reason: `status='${e.status}' — classifier must resolve to 'ready' before push` }); continue; }
    if (e.target_qb_txn_kind !== 'bill_pmt') { skippedIneligible.push({ eventId: e.id, reason: `target_qb_txn_kind='${e.target_qb_txn_kind ?? 'null'}' — this consumer handles bill_pmt only` }); continue; }
    const matched = e.matched_invoice_ids ?? [];
    if (matched.length === 0) { skippedIneligible.push({ eventId: e.id, reason: 'matched_invoice_ids is empty — nothing to pay against' }); continue; }
    if (e.raw_data?.convera_transaction_id == null) {
      skippedIneligible.push({ eventId: e.id, reason: 'raw_data.convera_transaction_id missing — shadow-write drift' });
      continue;
    }
    eligible.push(e);
  }

  if (eligible.length === 0) return emptyReturn();

  // ─── Load supporting data ───────────────────────────────────────────────
  const invoiceIds = Array.from(new Set(eligible.flatMap(e => e.matched_invoice_ids ?? [])));
  const converaTxnIds = Array.from(new Set(eligible.map(e => e.raw_data!.convera_transaction_id!)));
  const userIdsForPps = Array.from(new Set()); // filled after invoices load

  const [invoicesRes, converaTxnsRes, umbrellaRes, vendorsRes, accountsRes] = await Promise.all([
    supabase.from('invoices').select('id, user_id, qb_bill_txn_id, total_amount, invoice_number, payment_profile').in('id', invoiceIds),
    supabase.from('convera_transactions').select('id, confirmation_number, date_of_order').in('id', converaTxnIds),
    supabase.from('convera_transaction_invoices').select('transaction_id, invoice_id, amount_share').in('transaction_id', converaTxnIds),
    supabase.from('qb_vendors').select('list_id, name'),
    supabase.from('qb_accounts').select('list_id, full_name').eq('account_type', 'Bank').eq('is_active', true),
  ]);
  void userIdsForPps;

  const invoiceById = new Map(((invoicesRes.data ?? []) as InvoiceRow[]).map(i => [i.id, i]));
  const converaTxnById = new Map(((converaTxnsRes.data ?? []) as ConveraTxnRow[]).map(t => [t.id, t]));
  const umbrellaByKey = new Map<string, number>();
  for (const row of ((umbrellaRes.data ?? []) as UmbrellaLinkRow[])) {
    const amt = Number(row.amount_share ?? 0);
    if (amt > 0) umbrellaByKey.set(`${row.transaction_id}::${row.invoice_id}`, amt);
  }
  const vendorByLowerName = new Map(((vendorsRes.data ?? []) as VendorRow[]).map(v => [v.name.toLowerCase().trim(), v]));
  const bank = findConveraBank((accountsRes.data ?? []) as AccountRow[]);

  // is_settled defensive guard for existing bills — mirrors pushConveraBillPmt.
  // Even though C-2 bypasses the executor, we still refuse to push a BillPmt
  // against a bill that qb_mirror knows is already paid (IIF-paid pre-cutover,
  // manual QB entry, prior push run).
  const existingBillTxnIds = Array.from(new Set(
    ((invoicesRes.data ?? []) as InvoiceRow[])
      .map(i => i.qb_bill_txn_id)
      .filter((x): x is string => !!x),
  ));
  const mirrorSettledByTxnId = new Map<string, boolean | null>();
  if (existingBillTxnIds.length > 0) {
    const { data: mirrorRows } = await supabase
      .from('qb_mirror')
      .select('entity_ref, is_settled')
      .eq('entity_kind', 'bill')
      .in('entity_ref', existingBillTxnIds);
    for (const m of (mirrorRows ?? []) as Array<{ entity_ref: string; is_settled: boolean | null }>) {
      mirrorSettledByTxnId.set(m.entity_ref, m.is_settled);
    }
  }

  // Live payment_profiles for the pp-scoped vendor resolver.
  const invoiceUserIds = Array.from(new Set(((invoicesRes.data ?? []) as InvoiceRow[]).map(i => i.user_id)));
  const { data: liveProfilesData } = invoiceUserIds.length > 0
    ? await supabase.from('payment_profiles').select('id, user_id, qb_vendor_name, is_default, company_name').in('user_id', invoiceUserIds)
    : { data: [] as PaymentProfileRow[] };
  const resolverPps: ResolverPaymentProfile[] = ((liveProfilesData ?? []) as PaymentProfileRow[]).map(pp => ({
    id: pp.id, userId: pp.user_id, qbVendorName: pp.qb_vendor_name, companyName: pp.company_name, isDefault: pp.is_default,
  }));

  // ─── Fan out: per-event → per-vendor sub-groups ─────────────────────────
  interface SubGroup {
    event: IngestEventRow;
    converaTxn: ConveraTxnRow;
    vendorName: string;
    invoices: Array<{ invoice: InvoiceRow; paymentAmount: number }>;
  }
  const subGroups: SubGroup[] = [];

  for (const e of eligible) {
    const converaTxn = converaTxnById.get(e.raw_data!.convera_transaction_id!);
    if (!converaTxn) { skippedIneligible.push({ eventId: e.id, reason: `convera_transactions row ${e.raw_data!.convera_transaction_id} not found` }); continue; }
    if (!converaTxn.date_of_order) { skippedIneligible.push({ eventId: e.id, reason: `convera_transactions.date_of_order missing for wire ${converaTxn.confirmation_number}` }); continue; }
    if (!bank) { skippedIneligible.push({ eventId: e.id, reason: `bank account matching '${CONVERA_BANK_PATTERN}' not found in qb_accounts` }); continue; }

    // Resolve each invoice to its vendor via pp-scoped chain, then bucket.
    const byVendor = new Map<string, Array<{ invoice: InvoiceRow; paymentAmount: number }>>();
    let anyResolveFail = false;
    for (const invId of (e.matched_invoice_ids ?? [])) {
      const inv = invoiceById.get(invId);
      if (!inv) {
        skippedIneligible.push({ eventId: e.id, reason: `matched invoice ${invId} not found in invoices table` });
        anyResolveFail = true; break;
      }
      const vendorName = resolveInvoiceQbVendorName(
        { snapPaymentProfileId: extractSnapPpId(inv.payment_profile), snapQbVendorName: (inv.payment_profile as { qbVendorName?: string | null } | null)?.qbVendorName ?? null, userId: inv.user_id },
        resolverPps,
      );
      if (!vendorName) {
        skippedIneligible.push({ eventId: e.id, reason: `invoice ${invId} has no resolvable qb_vendor_name (snap or live pp)` });
        anyResolveFail = true; break;
      }
      const vendor = vendorByLowerName.get(vendorName.toLowerCase().trim());
      if (!vendor) {
        skippedIneligible.push({ eventId: e.id, reason: `qb_vendors row missing for name='${vendorName}' — sync qb_vendors` });
        anyResolveFail = true; break;
      }
      const share = umbrellaByKey.get(`${converaTxn.id}::${invId}`);
      const paymentAmount = share ?? Number(inv.total_amount);
      const arr = byVendor.get(vendor.name) ?? [];
      arr.push({ invoice: inv, paymentAmount });
      byVendor.set(vendor.name, arr);
    }
    if (anyResolveFail) continue;

    for (const [vendorName, arr] of byVendor) {
      subGroups.push({ event: e, converaTxn, vendorName, invoices: arr });
    }
  }

  if (subGroups.length === 0) return emptyReturn();

  // ─── Enqueue bill_add for every missing invoice via delegated consumer ──
  const allMissingInvoiceIds = subGroups
    .flatMap(g => g.invoices.filter(i => !i.invoice.qb_bill_txn_id).map(i => i.invoice.id));

  const billAddJobIdByInvoiceId = new Map<number, number>();
  let createResult: Awaited<ReturnType<typeof pushConveraInvoiceCreateBill>> | null = null;

  if (allMissingInvoiceIds.length > 0) {
    createResult = await pushConveraInvoiceCreateBill(supabase, allMissingInvoiceIds, { auditTag });
    for (const p of createResult.perIntent) {
      if (p.jobId == null) continue;
      for (const invId of p.sourceInvoiceIds) billAddJobIdByInvoiceId.set(invId, p.jobId);
    }
    // Absorb delegated skips into eventId-keyed reasons.
    for (const s of createResult.skippedIneligible) {
      const g = subGroups.find(sg => sg.invoices.some(i => i.invoice.id === s.invoiceId));
      if (g) skippedIneligible.push({ eventId: g.event.id, reason: `bill_add skipped for invoice ${s.invoiceId}: ${s.reason}` });
    }
    for (const r of createResult.rejected) {
      const intent = r.intent as { sourceInvoiceIds?: number[] } | undefined;
      const invId = intent?.sourceInvoiceIds?.[0];
      const g = invId != null ? subGroups.find(sg => sg.invoices.some(i => i.invoice.id === invId)) : undefined;
      if (g) skippedIneligible.push({ eventId: g.event.id, reason: `bill_add rejected for invoice ${invId}: ${r.invariant} — ${r.reason}` });
    }
  }

  // ─── Build one bill_pmt_add per sub-group ───────────────────────────────
  interface PayRow {
    kind: 'bill_pmt_add';
    payload: Record<string, unknown>;
    status: 'pending';
    depends_on: number[];
  }
  const payRows: PayRow[] = [];
  const payMeta: Array<{ eventId: number; firstBillAddJobId: number | null }> = [];
  const billAddJobIds: number[] = [];

  for (const g of subGroups) {
    const applications: Array<{ billTxnId: string | null; paymentAmount: number }> = [];
    const dependsOn: number[] = [];
    const hydrateSlots: Array<{ depJobId: number; applicationIndex: number }> = [];
    let anySubGroupSkipReason: string | null = null;

    for (let i = 0; i < g.invoices.length; i++) {
      const { invoice, paymentAmount } = g.invoices[i];
      if (invoice.qb_bill_txn_id) {
        const settled = mirrorSettledByTxnId.get(invoice.qb_bill_txn_id);
        if (settled === true) {
          anySubGroupSkipReason = `existing bill TxnID '${invoice.qb_bill_txn_id}' (invoice ${invoice.id}) already settled in qb_mirror — pushing would duplicate the BillPmt`;
          break;
        }
        if (settled === undefined) {
          anySubGroupSkipReason = `existing bill TxnID '${invoice.qb_bill_txn_id}' (invoice ${invoice.id}) not in qb_mirror — can't confirm settled state. Run Sync QB state then retry.`;
          break;
        }
        applications.push({ billTxnId: invoice.qb_bill_txn_id, paymentAmount });
        continue;
      }
      const billAddJobId = billAddJobIdByInvoiceId.get(invoice.id);
      if (billAddJobId == null) {
        anySubGroupSkipReason = `no bill_add job enqueued for missing invoice ${invoice.id} — see delegated skip/reject reasons`;
        break;
      }
      applications.push({ billTxnId: null, paymentAmount });
      dependsOn.push(billAddJobId);
      hydrateSlots.push({ depJobId: billAddJobId, applicationIndex: i });
      billAddJobIds.push(billAddJobId);
    }
    if (anySubGroupSkipReason) {
      skippedIneligible.push({ eventId: g.event.id, reason: `sub-group vendor='${g.vendorName}' skipped: ${anySubGroupSkipReason}` });
      continue;
    }
    if (applications.length === 0) continue;

    const payload: Record<string, unknown> = {
      payeeVendorName: g.vendorName,
      bankAccountName: bank!.full_name,
      txnDate: g.converaTxn.date_of_order!,
      refNumber: g.converaTxn.confirmation_number,
      memo: `Convera wire ${g.converaTxn.confirmation_number}`,
      applications,
      sourceConveraTxnId: g.converaTxn.id,
      __audit_tag: auditTag,
    };
    // Choose hydration mechanism. Single-slot uses the older
    // __hydrate_bill_txn_id_from_dep marker for backward-compat with the
    // qb-web-connector edge fn's existing branch. Multi-slot uses the newer
    // __hydrate_from_deps array (edge fn extended 2026-09-02 as part of C-3).
    if (hydrateSlots.length === 1 && hydrateSlots[0].applicationIndex === 0) {
      payload.__hydrate_bill_txn_id_from_dep = hydrateSlots[0].depJobId;
    } else if (hydrateSlots.length > 0) {
      payload.__hydrate_from_deps = hydrateSlots;
    }

    payRows.push({ kind: 'bill_pmt_add', payload, status: 'pending', depends_on: dependsOn });
    payMeta.push({ eventId: g.event.id, firstBillAddJobId: hydrateSlots[0]?.depJobId ?? null });
  }

  if (payRows.length === 0) {
    return {
      jobIds: [...(createResult?.jobIds ?? [])],
      rejected: [...(createResult?.rejected ?? [])],
      skippedDuplicate: [...(createResult?.skippedDuplicate ?? [])],
      skippedIneligible,
      billAddJobIds,
      chainedPayJobIds: [],
      verifyJobIdByPayJobId: {},
    };
  }

  const { data: insertedPay, error: payErr } = await supabase
    .from('qb_sync_jobs')
    .insert(payRows)
    .select('id');
  if (payErr) {
    for (const meta of payMeta) {
      skippedIneligible.push({ eventId: meta.eventId, reason: `chained pay_bill insert failed: ${payErr.message}. Bill_adds already enqueued; push pay manually after they drain.` });
    }
    return {
      jobIds: [...(createResult?.jobIds ?? [])],
      rejected: [...(createResult?.rejected ?? [])],
      skippedDuplicate: [...(createResult?.skippedDuplicate ?? [])],
      skippedIneligible,
      billAddJobIds,
      chainedPayJobIds: [],
      verifyJobIdByPayJobId: {},
    };
  }

  const chainedPayJobIds: number[] = [];
  const verifyJobIdByPayJobId: Record<number, number> = {};

  interface VerifyRow {
    kind: 'bill_query';
    payload: Record<string, unknown>;
    status: 'pending';
    depends_on: number[];
  }
  const verifyRows: VerifyRow[] = [];
  const verifyMeta: Array<{ payJobId: number }> = [];

  (insertedPay as Array<{ id: number }>).forEach((row, idx) => {
    const meta = payMeta[idx];
    chainedPayJobIds.push(row.id);
    // Verify chain: piggybacks single-slot hydration on the FIRST bill_add
    // (arbitrary — the mirror snapshot after full drain gives the real
    // multi-bill verify signal). Verify absent when the sub-group had all
    // pre-existing bills (no bill_add to piggyback on).
    if (meta.firstBillAddJobId != null) {
      verifyRows.push({
        kind: 'bill_query',
        payload: {
          txnIds: [null],
          __hydrate_bill_txn_id_from_dep: meta.firstBillAddJobId,
          __audit_tag: `${auditTag}-verify`,
          __verify_for_event_id: meta.eventId,
        },
        status: 'pending',
        depends_on: [row.id],
      });
      verifyMeta.push({ payJobId: row.id });
    }
  });

  if (verifyRows.length > 0) {
    const { data: insertedVerify, error: verifyErr } = await supabase
      .from('qb_sync_jobs')
      .insert(verifyRows)
      .select('id');
    if (!verifyErr && insertedVerify) {
      (insertedVerify as Array<{ id: number }>).forEach((row, idx) => {
        verifyJobIdByPayJobId[verifyMeta[idx].payJobId] = row.id;
      });
    }
  }

  return {
    jobIds: [...(createResult?.jobIds ?? []), ...chainedPayJobIds],
    rejected: [...(createResult?.rejected ?? [])],
    skippedDuplicate: [...(createResult?.skippedDuplicate ?? [])],
    skippedIneligible,
    billAddJobIds,
    chainedPayJobIds,
    verifyJobIdByPayJobId,
  };
}
