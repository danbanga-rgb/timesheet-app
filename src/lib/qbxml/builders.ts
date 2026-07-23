// qbXML request builders — pure functions, no I/O.
//
// Each builder emits a single request ELEMENT (e.g. <BillQueryRq>...</BillQueryRq>).
// Wrap one or more with wrapQbxmlRequests() from ./envelope.ts to produce a
// full QBXML round-trip payload.
//
// Session 1 (this file, initial): BillQueryRq only.
// Session 2 will add BillAddRq, Session 3 will add BillPaymentCheckAddRq.

import type { BillAddRqInput, BillQueryRqInput } from './types';
import { xmlEscape } from './envelope';
import { DEFAULT_AP_ACCOUNT, DEFAULT_EXPENSE_ACCOUNT } from './constants';

/** Format a monetary amount as a qbXML AMTTYPE string (2 decimal places).
 *  Matches how the existing IIF export renders amounts, and matches how
 *  QB itself stores currency. See GOTCHAS.md re: multi-currency (not now). */
function fmtAmount(n: number): string {
  return n.toFixed(2);
}

/** Build a <BillQueryRq> element.
 *
 * Queries QB for bills matching any of the supplied RefNumbers. The response
 * (parsed by parseBillQueryRs, arriving in a later session) yields TxnIDs
 * which we then use as the AppliedToTxnAdd.TxnID target when creating a
 * BillPaymentCheckAdd. See project_qb_web_connector_design memory for the
 * query-then-apply flow.
 *
 * Notes on RefNumber matching semantics in QB Desktop:
 *  - RefNumberList entries are matched by exact string equality (not substring).
 *  - Matching is case-INSENSITIVE by default. Use RefNumberCaseSensitiveList
 *    instead if we ever need case sensitivity (we don't today).
 *  - IncludeLineItems=false because we only need the header (RefNumber, TxnID,
 *    EditSequence). Avoids QB pulling line detail we won't consume.
 */
export function buildBillQueryRq(input: BillQueryRqInput): string {
  if (input.refNumbers.length === 0) {
    throw new Error('buildBillQueryRq: refNumbers must not be empty');
  }
  const attrs = input.requestId
    ? ` requestID="${xmlEscape(input.requestId)}"`
    : '';
  const parts: string[] = [`<BillQueryRq${attrs}>`];
  for (const ref of input.refNumbers) {
    parts.push(`  <RefNumberList>${xmlEscape(ref)}</RefNumberList>`);
  }
  if (input.maxReturned != null) {
    parts.push(`  <MaxReturned>${input.maxReturned}</MaxReturned>`);
  }
  parts.push('  <IncludeLineItems>false</IncludeLineItems>');
  parts.push('</BillQueryRq>');
  return parts.join('\n');
}

/** Build a <BillAddRq> element.
 *
 * qbXML element ordering inside <BillAdd> is STRICT — QB rejects requests
 * that send elements out of spec order with a schema error. The order used
 * below matches the Intuit spec (also confirmed in Consolibyte schema):
 *
 *    VendorRef → APAccountRef → TxnDate → DueDate → RefNumber →
 *    (TermsRef) → Memo → (IsTaxIncluded) → (SalesTaxCodeRef) →
 *    ExpenseLineAdd+ → (LinkToTxnID) → (ExternalGUID)
 *
 * We omit optional elements we don't use (TermsRef, tax refs, ExternalGUID).
 * DueDate is included when supplied — mixing TermsRef + explicit DueDate
 * risks ambiguity; we compute DueDate ourselves (like the IIF flow) so QB
 * gets an explicit answer.
 *
 * ExpenseLineAdd.Amount is entered as POSITIVE (an expense debit). QB
 * derives the corresponding A/P credit internally. This differs from IIF
 * where the caller wrote both sides explicitly.
 *
 * See constants.ts for DEFAULT_AP_ACCOUNT and DEFAULT_EXPENSE_ACCOUNT.
 * See GOTCHAS.md for the RefNumber length constraint (differs from
 * BillPaymentCheck's 11-char limit — Bills likely tolerate up to 20).
 */
export function buildBillAddRq(input: BillAddRqInput): string {
  if (input.lines.length === 0) {
    throw new Error('buildBillAddRq: at least one line required');
  }
  const apAccount = input.apAccountName ?? DEFAULT_AP_ACCOUNT;
  const defaultExpenseAccount =
    input.defaultExpenseAccountName ?? DEFAULT_EXPENSE_ACCOUNT;

  const attrs = input.requestId
    ? ` requestID="${xmlEscape(input.requestId)}"`
    : '';
  const parts: string[] = [`<BillAddRq${attrs}>`, '  <BillAdd>'];
  parts.push(`    <VendorRef>`);
  parts.push(`      <FullName>${xmlEscape(input.vendorName)}</FullName>`);
  parts.push(`    </VendorRef>`);
  parts.push(`    <APAccountRef>`);
  parts.push(`      <FullName>${xmlEscape(apAccount)}</FullName>`);
  parts.push(`    </APAccountRef>`);
  parts.push(`    <TxnDate>${xmlEscape(input.txnDate)}</TxnDate>`);
  if (input.dueDate) {
    parts.push(`    <DueDate>${xmlEscape(input.dueDate)}</DueDate>`);
  }
  parts.push(`    <RefNumber>${xmlEscape(input.refNumber)}</RefNumber>`);
  if (input.memo) {
    parts.push(`    <Memo>${xmlEscape(input.memo)}</Memo>`);
  }
  for (const line of input.lines) {
    const account = line.expenseAccountName ?? defaultExpenseAccount;
    parts.push(`    <ExpenseLineAdd>`);
    parts.push(`      <AccountRef>`);
    parts.push(`        <FullName>${xmlEscape(account)}</FullName>`);
    parts.push(`      </AccountRef>`);
    parts.push(`      <Amount>${fmtAmount(line.amount)}</Amount>`);
    if (line.memo) {
      parts.push(`      <Memo>${xmlEscape(line.memo)}</Memo>`);
    }
    parts.push(`    </ExpenseLineAdd>`);
  }
  parts.push('  </BillAdd>');
  parts.push('</BillAddRq>');
  return parts.join('\n');
}
