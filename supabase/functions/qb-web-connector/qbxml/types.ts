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

/** BillPaymentCheckAddRq: record a check-style bill payment (Convera wire, ACH,
 *  or physical check) tied to a bank account and applied to one or more bills.
 *
 *  Represents ONE payment covering ONE payee vendor. If a single wire covers
 *  bills for multiple vendors (rare in our Convera flow — routing is per
 *  beneficiary — but possible), the caller enqueues one job per (vendor, wire)
 *  pair with the same TxnDate + BankAccount + RefNumber.
 *
 *  Semantics mirror the existing IIF payment export
 *  (`buildPaymentIifPreview` / IIF CHECK+BILLPMT rows in TimesheetSystem.tsx)
 *  so QB behaves identically: one wire → one bank debit → applied against the
 *  covered A/P bills. The improvement over IIF is auto-apply via TxnID — no
 *  more DOCNUM string-matching gymnastics.
 */
export interface BillPaymentCheckAddRqInput {
  /** qb_vendor_name — must match an existing QB vendor exactly. Same source of
   *  truth as BillAddRqInput.vendorName (payment_profiles.qb_vendor_name). */
  payeeVendorName: string;
  /** A/P account whose bills we're paying down. Defaults to DEFAULT_AP_ACCOUNT. */
  apAccountName?: string;
  /** Payment date. YYYY-MM-DD. Existing IIF uses convera_transactions.payment_date. */
  txnDate: string;
  /** Bank account paying out. For Convera wires: WU_HOLDING (from constants).
   *  For direct disbursements: KEY_POINT_CHECKING. Caller decides. */
  bankAccountName: string;
  /** RefNumber — MAX 11 CHARS. Existing IIF/Payment flow uses the wire
   *  confirmation code (e.g. "OTR6607568", 10 chars — always fits). Builder
   *  throws if longer to prevent silent QB truncation. See GOTCHAS Session 3. */
  refNumber?: string;
  /** Payment-level memo. Existing IIF: "Convera wire — INV {invoice_number} — {vendor}". */
  memo?: string;
  /** Optional flag. Convera wires and ACH are NOT printed checks — leave
   *  unset (default) and QB uses its own default. Set false explicitly if you
   *  want to be defensive against a QB company setting that defaults new
   *  payments to "to be printed". */
  isToBePrinted?: boolean;
  /** One or more bills this payment covers. Required, min 1. */
  applications: BillPaymentApplicationInput[];
  /** Optional request correlation ID. */
  requestId?: string;
}

/** One bill being paid by a BillPaymentCheck. */
export interface BillPaymentApplicationInput {
  /** TxnID of the Bill in QB. Obtained via BillQueryRs lookup or persisted
   *  immediately after BillAddRs (see project_qb_web_connector_design memory). */
  billTxnId: string;
  /** Amount from this payment applied to this bill. Multiple applications
   *  in one BillPaymentCheck naturally split the bank debit across bills. */
  paymentAmount: number;
  /** Optional early-payment discount to book against this bill. */
  discountAmount?: number;
  /** REQUIRED if discountAmount is set — QB rejects a discount without an
   *  account to book it against. Builder throws if discountAmount is set
   *  without this. */
  discountAccountName?: string;
  /** Optional class for the discount line. */
  discountClassName?: string;
  /** Optional existing vendor credits in QB to consume alongside this
   *  payment (each SetCredit reduces the effective PaymentAmount needed
   *  from bank cash). Not used in the Convera MVP flow; supported here so
   *  a future accountant-triggered payment can drain credits. */
  setCredits?: SetCreditInput[];
}

/** Apply an existing vendor credit (e.g. from a prior overpayment) to a bill
 *  as part of a BillPaymentCheck. */
export interface SetCreditInput {
  /** TxnID of the Credit already in QB. */
  creditTxnId: string;
  /** Portion of the credit consumed by this application. */
  appliedAmount: number;
  /** If true, permits applying more than the credit's currently-available
   *  balance (QB surfaces a warning). Rare; leave unset in normal flow. */
  override?: boolean;
}

/** Result of parseBillPaymentCheckAddRs — the newly-created payment's identity. */
export interface BillPaymentCheckAddResult {
  txnId: string;
  editSequence: string;
  /** Echoed back only if we supplied one (RefNumber is optional on the request). */
  refNumber?: string;
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

/** Return shape of parseBillQueryRs. `results` is empty when statusCode !== 0
 *  OR when the query matched zero bills (see GOTCHAS Session 4 open question). */
export interface ParsedBillQueryRs {
  status: QbxmlResponseStatus;
  results: BillQueryResult[];
}

/** Return shape of parseBillAddRs. `result` is null on any non-success status. */
export interface ParsedBillAddRs {
  status: QbxmlResponseStatus;
  result: BillAddResult | null;
}

/** Return shape of parseBillPaymentCheckAddRs. `result` is null on any non-success status. */
export interface ParsedBillPaymentCheckAddRs {
  status: QbxmlResponseStatus;
  result: BillPaymentCheckAddResult | null;
}
