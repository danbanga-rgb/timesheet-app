// qbWrite — atomic intent types.
//
// The executor accepts a list of these, validates every invariant listed in
// INVARIANTS.md, and inserts corresponding rows into qb_sync_jobs. QBWC drains
// on its poll cycle. Persist step reads back into qb_mirror + domain tables.
//
// Three atomic intents ONLY:
//   pay_bill       — one BillPaymentCheck against 1..N existing bills for ONE vendor
//   create_bill    — one Bill (with 1..N expense lines for umbrella grouping)
//   check_expense  — one Check (with 1..N expense lines) — direct-expense passthrough
//
// No compound intents. Chaining (create bill THEN pay it) is a SCHEDULING concern:
// two intents, second's job carries `depends_on: [firstJobId]`. This keeps the
// executor's contract flat and eliminates a class of "which sub-request failed?"
// ambiguity from prior chained-request designs.

/** Discriminated union base — every intent carries an audit tag so we can trace
 *  which pusher (Intuit batch, Convera batch, proactive create, ...) emitted it.
 *  Written into qb_sync_jobs.payload.__audit_tag. */
export interface WriteIntentBase {
  /** Free-form tag for traceability. Convention: `<source>-<context>-<yyyymmdd>`,
   *  e.g. 'intuit-push-2026-08-21' or 'convera-proactive-billadd-2026-09-01'. */
  auditTag: string;
}

/** Pay an existing Bill (or bills for umbrella wires) with a single BillPmt.
 *
 *  Enforces:
 *  - RefNumber ≤ 11 chars (INVARIANTS #5)
 *  - Vendor-scoped TxnID: every `applications[].billTxnId` must belong to
 *    `payeeVendorName` (checked against qb_mirror) — INVARIANTS #11
 *  - ASCII-only inputs — INVARIANTS #1
 *  - Umbrella-safe: persistence writes into `convera_transaction_billpmts`
 *    for Convera-source intents — INVARIANTS #15
 */
export interface PayBillIntent extends WriteIntentBase {
  kind: 'pay_bill';
  /** Must match a qb_mirror vendor exactly. */
  payeeVendorName: string;
  /** BankAccountRef.FullName from qb_mirror. Caller decides between
   *  WU_HOLDING (Convera) / KEY_POINT_CHECKING (Intuit / direct). */
  bankAccountName: string;
  txnDate: string;                // YYYY-MM-DD
  /** Max 11 chars — Convera wire confirmation code fits. */
  refNumber?: string;
  memo?: string;
  applications: Array<{
    /** QB Bill TxnID. Must be for `payeeVendorName` — cross-checked at build. */
    billTxnId: string;
    /** Amount from this payment applied to this bill. */
    paymentAmount: number;
  }>;
  /** Persistence back-ref. EXACTLY ONE must be supplied. */
  sourceConveraTxnId?: number;
  sourceIngestEventId?: number;
}

/** Create a new Bill in QB (1..N expense lines for umbrella grouping). */
export interface CreateBillIntent extends WriteIntentBase {
  kind: 'create_bill';
  vendorName: string;
  txnDate: string;                // YYYY-MM-DD
  dueDate?: string;               // YYYY-MM-DD
  /** RefNumber = normally the invoice_number (single) or MULTI-YYYY-MM (legacy). */
  refNumber: string;
  memo?: string;
  apAccountName?: string;         // defaults to DEFAULT_AP_ACCOUNT
  defaultExpenseAccountName?: string;
  lines: Array<{
    amount: number;
    memo?: string;
    expenseAccountName?: string;  // per-line override; falls back to default
  }>;
  /** Persistence back-ref: which invoices this bill covers. Length 1 for
   *  per-invoice bills; N for MULTI-grouped bills. Empty for orphan-create
   *  (G7b TechAntz-style: no invoice in our system). */
  sourceInvoiceIds: number[];
  /** Orphan-create persistence back-ref (G7b). Set when creating a Bill
   *  triggered by a qb_ingest_event that has no matching invoice. Edge fn
   *  drain handler writes the resulting bill TxnID onto the event row
   *  (resolved_bill_txn_id) instead of onto invoices. Mutually exclusive
   *  with a non-empty sourceInvoiceIds. */
  sourceIngestEventId?: number;
}

/** Write a direct-expense Check (bypasses A/P entirely). Used for Lucien-style
 *  passthroughs. */
export interface CheckExpenseIntent extends WriteIntentBase {
  kind: 'check_expense';
  bankAccountName: string;
  payeeVendorName: string;
  txnDate: string;                // YYYY-MM-DD
  refNumber?: string;
  memo?: string;
  lines: Array<{
    expenseAccountName: string;   // required per line
    amount: number;
    memo?: string;
  }>;
  sourceIngestEventId: number;
}

export type WriteIntent = PayBillIntent | CreateBillIntent | CheckExpenseIntent;

/** Result of executing a batch of intents. */
export interface ExecuteResult {
  /** qb_sync_jobs.id per enqueued intent, order-preserving with input. */
  jobIds: Array<number | null>;
  /** Intents rejected during validation. Never enqueued. */
  rejected: Array<{
    index: number;
    intent: WriteIntent;
    reason: string;
    invariant: string;   // e.g. "INVARIANTS #5 — refNumber max 11 chars"
  }>;
  /** Intents skipped as duplicates of already-posted work (idempotency). */
  skippedDuplicate: Array<{
    index: number;
    intent: WriteIntent;
    reason: string;
  }>;
}
