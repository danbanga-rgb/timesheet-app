// Input types for qbXML request builders.
//
// These types describe what our app hands to the builders — they're
// deliberately reduced from the full DB row types (Invoice, ConveraTransaction,
// PaymentProfile in TimesheetSystem.tsx) to keep the builders decoupled from
// UI/DB concerns and easy to unit-test with plain fixtures.

/** BillQueryRq: look up bills by RefNumber (our invoice_number). */
export interface BillQueryRqInput {
  /** Ref numbers to search for. Corresponds to our `invoices.invoice_number`. */
  refNumbers: string[];
  /** Optional request correlation ID. Web Connector echoes this back on the
   *  response so we can pair request→response when batching multiple ops. */
  requestId?: string;
  /** Optional cap on results. Default: unbounded. */
  maxReturned?: number;
}

/** Result of parseBillQueryRs — one entry per matched bill. */
export interface BillQueryResult {
  refNumber: string;
  txnId: string;
  editSequence: string;
}

/** BillAddRq: create a Vendor Bill in QB.
 *
 *  Represents ONE bill — for a combined (umbrella) bill covering multiple
 *  contractors, callers group at their layer and supply one BillAddRqInput
 *  per group with N `lines`.
 *
 *  Semantics mirror the existing IIF bill export (`buildIifContent` in
 *  TimesheetSystem.tsx) so QB behaves identically to today's flow — same
 *  vendor, same A/P and expense account, same due date policy.
 */
export interface BillAddRqInput {
  /** qb_vendor_name — must match an existing QB vendor exactly. */
  vendorName: string;
  /** A/P account. Defaults to "Accounts Payable" via constants. */
  apAccountName?: string;
  /** Default expense account for any line that doesn't override. */
  defaultExpenseAccountName?: string;
  /** Bill date. YYYY-MM-DD. Existing IIF uses last day of period_end month. */
  txnDate: string;
  /** Due date. YYYY-MM-DD. Existing IIF uses txnDate + max(payment_terms days). */
  dueDate?: string;
  /** RefNumber — invoice_number for single-invoice bills, or a combined tag
   *  like "M-202605" for umbrella bills. See GOTCHAS.md for length constraints. */
  refNumber: string;
  /** Bill-level memo. Existing IIF: single → "{Month YYYY} — {h}h @ ${r} — {name}";
   *  multi → "{Month YYYY} — {N} contractors — {totalHours}h total". */
  memo?: string;
  /** One ExpenseLineAdd per contractor. Multiple lines produce a combined bill. */
  lines: BillAddRqLine[];
  /** Optional request correlation ID. */
  requestId?: string;
}

export interface BillAddRqLine {
  /** Positive amount (expense debit). QB auto-derives the A/P credit. */
  amount: number;
  /** Per-line memo. Existing IIF: "{Mon YYYY} — {h}h @ ${r} — {name} — INV {refNumber}". */
  memo?: string;
  /** Per-line expense account override. Falls back to defaultExpenseAccountName. */
  expenseAccountName?: string;
}

/** Result of parseBillAddRs — the newly-created bill's identity. */
export interface BillAddResult {
  txnId: string;
  editSequence: string;
  refNumber: string;
}

/** Common shape for any parsed qbXML response. */
export interface QbxmlResponseStatus {
  /** statusCode="0" is success; anything else is an error. */
  statusCode: string;
  /** "Info" | "Warn" | "Error" — Error means the operation failed. */
  statusSeverity: 'Info' | 'Warn' | 'Error' | string;
  /** Human-readable status message. */
  statusMessage: string;
  /** Echoed requestID if we supplied one. */
  requestId?: string;
}
