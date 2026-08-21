// qbWrite/execute — the atomic-intent executor. Turns a list of validated
// intents into qb_sync_jobs rows. QBWC drains those on its poll cycle.
//
// READ src/lib/qbWrite/INVARIANTS.md BEFORE MODIFYING THIS FILE.
// This module is the ONE PLACE all battle-tested QB write rules are enforced.
// Every rule regression here is a real-money bug — see prior incidents cited
// in INVARIANTS.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertAscii } from '../qbxml/envelope';
import type { ExecuteResult, WriteIntent } from './types';

type SB = SupabaseClient;

/** QB Desktop hard cap on BillPaymentCheck.RefNumber. See INVARIANTS #5. */
const PAY_BILL_REFNUMBER_MAX = 11;

export interface ValidateFailure {
  reason: string;
  invariant: string;
}

/** Wrap assertAscii to return { reason } instead of throwing.
 *  Field values pass through unchanged; caller supplies field name for error text. */
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
  // Vendor / account names, memo, refNumber all pass to qbXML → Xerces →
  // Windows-1252. Non-ASCII produces UTFDataFormatException from QB.
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

  // Additional invariants land in subsequent commits, each un-skipping its it.todo test.
  return null;
}

/** Enqueue a batch of intents. Validates each; skips duplicates; inserts
 *  the rest into qb_sync_jobs. Returns per-intent status.
 *
 *  SCAFFOLD — enqueue path lands in a later commit. Validation is live. */
export async function executeIntents(_supabase: SB, intents: WriteIntent[]): Promise<ExecuteResult> {
  const rejected: ExecuteResult['rejected'] = [];
  const jobIds: ExecuteResult['jobIds'] = intents.map(() => null);
  intents.forEach((intent, index) => {
    const v = validateIntent(intent);
    if (v) rejected.push({ index, intent, ...v });
  });
  return {
    jobIds,
    rejected,
    skippedDuplicate: [],
  };
}
