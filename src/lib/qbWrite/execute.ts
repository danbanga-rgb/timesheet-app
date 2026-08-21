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

/** Enqueue a batch of intents. For each intent:
 *  1. validateIntent (all shape rules)
 *  2. build payload for the target job kind
 *  3. validatePayload (against qbxml/job-payloads contract — INVARIANTS #14)
 *  4. INSERT into qb_sync_jobs (status='pending')
 *
 *  Intents fail INDEPENDENTLY. A validation failure on intent[i] does not
 *  block intent[i+1] from enqueueing. Returns per-intent result — caller
 *  reports the summary. */
export async function executeIntents(
  supabase: SB,
  intents: WriteIntent[],
): Promise<ExecuteResult> {
  const rejected: ExecuteResult['rejected'] = [];
  const jobIds: ExecuteResult['jobIds'] = intents.map(() => null);

  // Build + validate each. Collect the ones that pass all checks + will be inserted.
  const toInsert: Array<{ index: number; row: { kind: JobKind; payload: Record<string, unknown>; status: 'pending' } }> = [];
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
    toInsert.push({ index: i, row: { kind, payload, status: 'pending' } });
  }

  if (toInsert.length === 0) {
    return { jobIds, rejected, skippedDuplicate: [] };
  }

  // Single batch insert. INSERT INTO qb_sync_jobs (kind, payload, status) returning id.
  const rows = toInsert.map(t => t.row);
  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .insert(rows)
    .select('id');
  if (error) {
    // Whole batch fails — mark them all as rejected with DB error. Callers can retry.
    for (const t of toInsert) {
      rejected.push({
        index: t.index,
        intent: intents[t.index],
        reason: `qb_sync_jobs insert failed: ${error.message}`,
        invariant: 'DB error (not an invariant violation) — retryable',
      });
    }
    return { jobIds, rejected, skippedDuplicate: [] };
  }

  // Map returned IDs back to their original intent index. Rely on order preservation
  // (PostgREST returns rows in insert order).
  (data ?? []).forEach((row: { id: number }, idx: number) => {
    const t = toInsert[idx];
    if (t) jobIds[t.index] = row.id;
  });
  return { jobIds, rejected, skippedDuplicate: [] };
}
