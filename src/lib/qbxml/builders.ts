// qbXML request builders — pure functions, no I/O.
//
// Each builder emits a single request ELEMENT (e.g. <BillQueryRq>...</BillQueryRq>).
// Wrap one or more with wrapQbxmlRequests() from ./envelope.ts to produce a
// full QBXML round-trip payload.
//
// Session 1 (this file, initial): BillQueryRq only.
// Session 2 will add BillAddRq, Session 3 will add BillPaymentCheckAddRq.

import type { BillQueryRqInput } from './types';
import { xmlEscape } from './envelope';

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
