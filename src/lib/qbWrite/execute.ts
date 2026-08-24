// qbWrite/execute — the atomic-intent executor. Turns a list of validated
// intents into qb_sync_jobs rows. QBWC drains those on its poll cycle.
//
// READ src/lib/qbWrite/INVARIANTS.md BEFORE MODIFYING THIS FILE.
// This module is the ONE PLACE all battle-tested QB write rules are enforced.
// Every rule regression here is a real-money bug — see prior incidents cited
// in INVARIANTS.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertAscii } from '../qbxml/envelope';
import { validatePayload, type JobKind } from '../qbxml/job-payloads';
import type {
  CheckExpenseIntent,
  CreateBillIntent,
  ExecuteResult,
  PayBillIntent,
  WriteIntent,
} from './types';

type SB = SupabaseClient;

/** QB Desktop hard cap on BillPaymentCheck.RefNumber. See INVARIANTS #5. */
const PAY_BILL_REFNUMBER_MAX = 11;

export interface ValidateFailure {
  reason: string;
  invariant: string;
}

// ─── Input-shape validation (no DB required) ────────────────────────────────

function checkAscii(fieldName: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  try {
    assertAscii(fieldName, value);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Validate a single intent against every applicable invariant.
 *  Returns null on pass; { reason, invariant } on first failure.
 *  Stops at first failure — caller sees one reason per rejected intent. */
export function validateIntent(intent: WriteIntent): ValidateFailure | null {
  // ─── INVARIANTS #1 — ASCII-only on every user-facing string field ───
  const asciiFields: Array<[string, string | null | undefined]> = [];
  if (intent.kind === 'pay_bill') {
    asciiFields.push(
      ['payeeVendorName', intent.payeeVendorName],
      ['bankAccountName', intent.bankAccountName],
      ['refNumber', intent.refNumber],
      ['memo', intent.memo],
    );
    for (const app of intent.applications) {
      asciiFields.push(['applications[].billTxnId', app.billTxnId]);
    }
  } else if (intent.kind === 'create_bill') {
    asciiFields.push(
      ['vendorName', intent.vendorName],
      ['refNumber', intent.refNumber],
      ['memo', intent.memo],
      ['apAccountName', intent.apAccountName],
      ['defaultExpenseAccountName', intent.defaultExpenseAccountName],
    );
    intent.lines.forEach((l, i) => {
      asciiFields.push(
        [`lines[${i}].memo`, l.memo],
        [`lines[${i}].expenseAccountName`, l.expenseAccountName],
      );
    });
  } else if (intent.kind === 'check_expense') {
    asciiFields.push(
      ['bankAccountName', intent.bankAccountName],
      ['payeeVendorName', intent.payeeVendorName],
      ['refNumber', intent.refNumber],
      ['memo', intent.memo],
    );
    intent.lines.forEach((l, i) => {
      asciiFields.push(
        [`lines[${i}].expenseAccountName`, l.expenseAccountName],
        [`lines[${i}].memo`, l.memo],
      );
    });
  }
  for (const [name, value] of asciiFields) {
    const err = checkAscii(name, value);
    if (err) return { reason: err, invariant: 'INVARIANTS #1 — ASCII-only' };
  }

  // ─── INVARIANTS #5 — pay_bill RefNumber max 11 chars ───
  if (intent.kind === 'pay_bill' && intent.refNumber != null && intent.refNumber.length > PAY_BILL_REFNUMBER_MAX) {
    return {
      reason: `pay_bill refNumber '${intent.refNumber}' is ${intent.refNumber.length} chars; QB Desktop hard cap is ${PAY_BILL_REFNUMBER_MAX} (BillPaymentCheck field limit). Use the wire confirmation code instead of the invoice number.`,
      invariant: 'INVARIANTS #5 — pay_bill refNumber max 11 chars',
    };
  }

  // ─── Source-ref exclusivity for pay_bill (feeds INVARIANTS #14 + #15) ───
  // Convera path uses sourceConveraTxnId; Intuit path uses sourceIngestEventId.
  // Exactly one must be present so persist step knows which domain row to update.
  if (intent.kind === 'pay_bill') {
    const hasConvera = intent.sourceConveraTxnId != null;
    const hasIntuit = intent.sourceIngestEventId != null;
    if (hasConvera && hasIntuit) {
      return {
        reason: 'pay_bill: exactly ONE of sourceConveraTxnId / sourceIngestEventId must be set — both were supplied',
        invariant: 'INVARIANTS #14 — payload contract (one-of source ref)',
      };
    }
    if (!hasConvera && !hasIntuit) {
      return {
        reason: 'pay_bill: exactly ONE of sourceConveraTxnId / sourceIngestEventId must be set — neither was supplied',
        invariant: 'INVARIANTS #14 — payload contract (one-of source ref)',
      };
    }
  }

  // ─── create_bill: lines[] must be non-empty ───
  if (intent.kind === 'create_bill' && intent.lines.length === 0) {
    return {
      reason: 'create_bill: lines[] must contain at least one expense line',
      invariant: 'INVARIANTS #14 — payload contract',
    };
  }
  // ─── check_expense: lines[] must be non-empty ───
  if (intent.kind === 'check_expense' && intent.lines.length === 0) {
    return {
      reason: 'check_expense: lines[] must contain at least one expense line',
      invariant: 'INVARIANTS #14 — payload contract',
    };
  }
  // ─── pay_bill: applications[] must be non-empty ───
  if (intent.kind === 'pay_bill' && intent.applications.length === 0) {
    return {
      reason: 'pay_bill: applications[] must contain at least one bill to pay',
      invariant: 'INVARIANTS #14 — payload contract',
    };
  }

  return null;
}

// ─── Payload builders — intent → qb_sync_jobs.payload ───────────────────────

function buildPayBillPayload(intent: PayBillIntent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    payeeVendorName: intent.payeeVendorName,
    bankAccountName: intent.bankAccountName,
    txnDate: intent.txnDate,
    refNumber: intent.refNumber,
    memo: intent.memo,
    applications: intent.applications,
    __audit_tag: intent.auditTag,
  };
  if (intent.sourceConveraTxnId != null) payload.sourceConveraTxnId = intent.sourceConveraTxnId;
  if (intent.sourceIngestEventId != null) payload.sourceIngestEventId = intent.sourceIngestEventId;
  return payload;
}

function buildCreateBillPayload(intent: CreateBillIntent): Record<string, unknown> {
  return {
    vendorName: intent.vendorName,
    apAccountName: intent.apAccountName,
    defaultExpenseAccountName: intent.defaultExpenseAccountName,
    txnDate: intent.txnDate,
    dueDate: intent.dueDate,
    refNumber: intent.refNumber,
    memo: intent.memo,
    lines: intent.lines,
    sourceInvoiceIds: intent.sourceInvoiceIds,
    __audit_tag: intent.auditTag,
  };
}

function buildCheckExpensePayload(intent: CheckExpenseIntent): Record<string, unknown> {
  return {
    payeeVendorName: intent.payeeVendorName,
    bankAccountName: intent.bankAccountName,
    txnDate: intent.txnDate,
    refNumber: intent.refNumber,
    memo: intent.memo,
    lines: intent.lines,
    sourceIngestEventId: intent.sourceIngestEventId,
    __audit_tag: intent.auditTag,
  };
}

function intentToJob(intent: WriteIntent): { kind: JobKind; payload: Record<string, unknown> } {
  if (intent.kind === 'pay_bill') return { kind: 'bill_pmt_add', payload: buildPayBillPayload(intent) };
  if (intent.kind === 'create_bill') return { kind: 'bill_add', payload: buildCreateBillPayload(intent) };
  return { kind: 'check_add', payload: buildCheckExpensePayload(intent) };
}

// ─── Enqueue path ───────────────────────────────────────────────────────────

// ─── Idempotency (INVARIANTS #18 + #19) ────────────────────────────────────
//
// Every intent carries a source_ref back to the domain row that spawned it:
//   pay_bill (Convera)  → convera_transactions.id via sourceConveraTxnId
//   pay_bill (Intuit)   → qb_ingest_events.id     via sourceIngestEventId
//   create_bill         → invoices.id[]           via sourceInvoiceIds
//   check_expense       → qb_ingest_events.id     via sourceIngestEventId
//
// Two dedup layers:
//   ALREADY DONE    — the QB write has already succeeded (domain row records it)
//   ALREADY IN-FLIGHT — a qb_sync_jobs row for this source_ref is pending or
//                       in_flight (draining right now)
//
// Either one → skippedDuplicate (not rejected — not an error, just a no-op).
// This is the same class of protection that stopped the 2026-08-14 silent-no-op
// bug (missing source_ref) and closes the "spam-click Push" race.

interface IdempotencyKey {
  index: number;
  intent: WriteIntent;
  kind: JobKind;
  payload: Record<string, unknown>;
}

// ─── Vendor-scoped TxnID check (INVARIANTS #11) ────────────────────────────
//
// For every pay_bill intent, cross-check that each applications[].billTxnId
// belongs to payeeVendorName in qb_mirror. Prevents the batch-15 class of
// bug (2026-08-13) where 3 payments got wrong-vendor TxnIDs because the
// reconciler picked a bill by refNumber alone across vendors.
//
// Returns a map (intent index → rejection reason). Only pay_bill kinds
// participate; other kinds skip cleanly.
async function findVendorMismatches(supabase: SB, candidates: IdempotencyKey[]): Promise<Map<number, string>> {
  const mismatches = new Map<number, string>();

  const payBillCandidates = candidates.filter(c => c.intent.kind === 'pay_bill');
  if (payBillCandidates.length === 0) return mismatches;

  const allTxnIds = new Set<string>();
  for (const c of payBillCandidates) {
    if (c.intent.kind !== 'pay_bill') continue;
    for (const app of c.intent.applications) allTxnIds.add(app.billTxnId);
  }
  if (allTxnIds.size === 0) return mismatches;

  const { data } = await supabase
    .from('qb_mirror')
    .select('entity_ref, vendor_list_id, data')
    .eq('entity_kind', 'bill')
    .in('entity_ref', Array.from(allTxnIds));

  // Bill lookup by TxnID → vendor name (from mirror row's data.vendor_name)
  const billVendor = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ entity_ref: string; data: Record<string, unknown> | null }>) {
    const vname = ((row.data ?? {}) as Record<string, unknown>).vendor_name;
    if (typeof vname === 'string') billVendor.set(row.entity_ref, vname);
  }

  for (const c of payBillCandidates) {
    if (c.intent.kind !== 'pay_bill') continue;
    for (const app of c.intent.applications) {
      const actualVendor = billVendor.get(app.billTxnId);
      if (actualVendor == null) {
        mismatches.set(c.index, `vendor-mismatch: bill TxnID '${app.billTxnId}' not found in qb_mirror (sync qb_mirror first)`);
        break;
      }
      if (actualVendor !== c.intent.payeeVendorName) {
        mismatches.set(c.index, `vendor-mismatch: bill TxnID '${app.billTxnId}' belongs to vendor '${actualVendor}' in qb_mirror, but pay_bill.payeeVendorName is '${c.intent.payeeVendorName}'. Batch-15-class regression — check reconciler.`);
        break;
      }
    }
  }
  return mismatches;
}

async function findDuplicates(supabase: SB, candidates: IdempotencyKey[]): Promise<Map<number, string>> {
  const dupReason = new Map<number, string>();
  if (candidates.length === 0) return dupReason;

  // ─── Collect the source_refs we care about, per kind ───
  const converaTxnIds = new Set<number>();     // Convera pay_bill
  const ingestEventIdsPay = new Set<number>(); // Intuit pay_bill
  const ingestEventIdsCheck = new Set<number>(); // check_expense
  const invoiceIds = new Set<number>();        // create_bill

  for (const c of candidates) {
    if (c.intent.kind === 'pay_bill' && c.intent.sourceConveraTxnId != null) converaTxnIds.add(c.intent.sourceConveraTxnId);
    if (c.intent.kind === 'pay_bill' && c.intent.sourceIngestEventId != null) ingestEventIdsPay.add(c.intent.sourceIngestEventId);
    if (c.intent.kind === 'check_expense') ingestEventIdsCheck.add(c.intent.sourceIngestEventId);
    if (c.intent.kind === 'create_bill') c.intent.sourceInvoiceIds.forEach(id => invoiceIds.add(id));
  }

  // ─── Layer 1: ALREADY-DONE domain checks ───
  //
  // Convera pay_bill: link table entry already exists for (convera_transaction, qb_vendor)
  if (converaTxnIds.size > 0) {
    const { data } = await supabase
      .from('convera_transaction_billpmts')
      .select('convera_transaction_id, qb_vendor_name')
      .in('convera_transaction_id', Array.from(converaTxnIds));
    const paidPairs = new Set<string>();
    for (const r of (data ?? []) as Array<{ convera_transaction_id: number; qb_vendor_name: string }>) {
      paidPairs.add(`${r.convera_transaction_id}::${r.qb_vendor_name}`);
    }
    for (const c of candidates) {
      if (c.intent.kind !== 'pay_bill' || c.intent.sourceConveraTxnId == null) continue;
      const key = `${c.intent.sourceConveraTxnId}::${c.intent.payeeVendorName}`;
      if (paidPairs.has(key)) {
        dupReason.set(c.index, `already-done: convera_transaction_billpmts has (${c.intent.sourceConveraTxnId}, "${c.intent.payeeVendorName}")`);
      }
    }
  }

  // Intuit pay_bill + check_expense: qb_ingest_events.status='posted' means the QB push already succeeded
  const postedIngestIds = new Set([...ingestEventIdsPay, ...ingestEventIdsCheck]);
  if (postedIngestIds.size > 0) {
    const { data } = await supabase
      .from('qb_ingest_events')
      .select('id, status')
      .in('id', Array.from(postedIngestIds))
      .eq('status', 'posted');
    const postedSet = new Set(((data ?? []) as Array<{ id: number }>).map(r => r.id));
    for (const c of candidates) {
      if (dupReason.has(c.index)) continue;
      const eventId = c.intent.kind === 'pay_bill' ? c.intent.sourceIngestEventId
                    : c.intent.kind === 'check_expense' ? c.intent.sourceIngestEventId
                    : null;
      if (eventId != null && postedSet.has(eventId)) {
        dupReason.set(c.index, `already-done: qb_ingest_events id=${eventId} status='posted'`);
      }
    }
  }

  // create_bill: invoices.qb_bill_txn_id already set means Bill exists in QB
  if (invoiceIds.size > 0) {
    const { data } = await supabase
      .from('invoices')
      .select('id, qb_bill_txn_id')
      .in('id', Array.from(invoiceIds))
      .not('qb_bill_txn_id', 'is', null);
    const withBillIds = new Set(((data ?? []) as Array<{ id: number }>).map(r => r.id));
    for (const c of candidates) {
      if (dupReason.has(c.index)) continue;
      if (c.intent.kind !== 'create_bill') continue;
      const overlap = c.intent.sourceInvoiceIds.filter(id => withBillIds.has(id));
      if (overlap.length > 0) {
        dupReason.set(c.index, `already-done: invoices ${overlap.join(', ')} already have qb_bill_txn_id set`);
      }
    }
  }

  // ─── Layer 2: ALREADY-IN-FLIGHT qb_sync_jobs check ───
  //
  // Query one bulk batch of pending/in_flight jobs of any relevant kind, then
  // match in JS against payload source_refs. Cheaper than N-per-intent JSONB
  // filters and works uniformly across PostgREST versions.
  const kindsInvolved = new Set(candidates.map(c => c.kind));
  const { data: inflight } = await supabase
    .from('qb_sync_jobs')
    .select('id, kind, payload, status')
    .in('kind', Array.from(kindsInvolved))
    .in('status', ['pending', 'in_flight']);
  const inflightRows = (inflight ?? []) as Array<{ id: number; kind: string; payload: Record<string, unknown> | null }>;

  for (const c of candidates) {
    if (dupReason.has(c.index)) continue;
    const match = inflightRows.find(row => {
      if (row.kind !== c.kind) return false;
      const p = row.payload ?? {};
      if (c.intent.kind === 'pay_bill' && c.intent.sourceConveraTxnId != null) {
        return p.sourceConveraTxnId === c.intent.sourceConveraTxnId
            && p.payeeVendorName === c.intent.payeeVendorName;
      }
      if (c.intent.kind === 'pay_bill' && c.intent.sourceIngestEventId != null) {
        return p.sourceIngestEventId === c.intent.sourceIngestEventId;
      }
      if (c.intent.kind === 'check_expense') {
        return p.sourceIngestEventId === c.intent.sourceIngestEventId;
      }
      if (c.intent.kind === 'create_bill') {
        const rowInvoiceIds = Array.isArray(p.sourceInvoiceIds) ? (p.sourceInvoiceIds as number[]) : [];
        return c.intent.sourceInvoiceIds.some(id => rowInvoiceIds.includes(id));
      }
      return false;
    });
    if (match) {
      dupReason.set(c.index, `in-flight: qb_sync_jobs id=${match.id} (${match.kind}) is already pending/in_flight for this source_ref`);
    }
  }

  return dupReason;
}

/** Enqueue a batch of intents. For each intent:
 *  1. validateIntent (all shape rules)
 *  2. build payload for the target job kind
 *  3. validatePayload (against qbxml/job-payloads contract — INVARIANTS #14)
 *  4. findDuplicates (INVARIANTS #18 already-done + #19 already-in-flight)
 *  5. INSERT surviving into qb_sync_jobs (status='pending')
 *
 *  Intents fail INDEPENDENTLY. A validation failure on intent[i] does not
 *  block intent[i+1] from enqueueing. Duplicates are skipped, not rejected. */
export async function executeIntents(
  supabase: SB,
  intents: WriteIntent[],
): Promise<ExecuteResult> {
  const rejected: ExecuteResult['rejected'] = [];
  const skippedDuplicate: ExecuteResult['skippedDuplicate'] = [];
  const jobIds: ExecuteResult['jobIds'] = intents.map(() => null);

  // ─── Steps 1-3: validate shape + payload, collect passing intents ───
  const candidates: IdempotencyKey[] = [];
  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];
    const v = validateIntent(intent);
    if (v) {
      rejected.push({ index: i, intent, ...v });
      continue;
    }
    const { kind, payload } = intentToJob(intent);
    const pv = validatePayload(kind, payload);
    if (!pv.ok) {
      rejected.push({
        index: i,
        intent,
        reason: pv.oneOfFailure ?? `missing payload keys: ${pv.missing.join(', ')}`,
        invariant: 'INVARIANTS #14 — payload contract (validatePayload)',
      });
      continue;
    }
    candidates.push({ index: i, intent, kind, payload });
  }

  // ─── Step 3.5: vendor-scoped TxnID check (INVARIANTS #11) ───
  // Runs BEFORE idempotency so a wrong-vendor mismatch is surfaced as a
  // real rejection, not silently swallowed as "duplicate."
  const vendorMismatches = await findVendorMismatches(supabase, candidates);
  const postVendorCheck = candidates.filter(c => {
    if (vendorMismatches.has(c.index)) {
      rejected.push({
        index: c.index,
        intent: c.intent,
        reason: vendorMismatches.get(c.index)!,
        invariant: 'INVARIANTS #11 — vendor-scoped TxnID (billTxnId must belong to payeeVendorName in qb_mirror)',
      });
      return false;
    }
    return true;
  });

  // ─── Step 4: idempotency ───
  const duplicates = await findDuplicates(supabase, postVendorCheck);
  const toInsert = postVendorCheck.filter(c => {
    if (duplicates.has(c.index)) {
      skippedDuplicate.push({ index: c.index, intent: c.intent, reason: duplicates.get(c.index)! });
      return false;
    }
    return true;
  });

  if (toInsert.length === 0) {
    return { jobIds, rejected, skippedDuplicate };
  }

  // ─── Step 5: batch insert ───
  const rows = toInsert.map(t => ({ kind: t.kind, payload: t.payload, status: 'pending' as const }));
  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .insert(rows)
    .select('id');
  if (error) {
    for (const t of toInsert) {
      rejected.push({
        index: t.index,
        intent: intents[t.index],
        reason: `qb_sync_jobs insert failed: ${error.message}`,
        invariant: 'DB error (not an invariant violation) — retryable',
      });
    }
    return { jobIds, rejected, skippedDuplicate };
  }

  (data ?? []).forEach((row: { id: number }, idx: number) => {
    const t = toInsert[idx];
    if (t) jobIds[t.index] = row.id;
  });
  return { jobIds, rejected, skippedDuplicate };
}
