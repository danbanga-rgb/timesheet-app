// qbXML request builders — pure functions, no I/O.
//
// Each builder emits a single request ELEMENT (e.g. <BillQueryRq>...</BillQueryRq>).
// Wrap one or more with wrapQbxmlRequests() from ./envelope.ts to produce a
// full QBXML round-trip payload.
//
// Session 1: BillQueryRq.
// Session 2: BillAddRq + constants.ts.
// Session 3 (this session): BillPaymentCheckAddRq — auto-apply the payment
// against previously-recorded bills using TxnID (replaces IIF DOCNUM matching).

import type {
  AccountQueryRqInput,
  BillAddRqInput,
  BillPaymentCheckAddRqInput,
  BillQueryRqInput,
  CheckAddRqInput,
  VendorQueryRqInput,
} from './types.ts';
import { assertAscii, xmlEscape } from './envelope.ts';
import { DEFAULT_AP_ACCOUNT, DEFAULT_EXPENSE_ACCOUNT } from './constants.ts';

/** QB Desktop limit for BillPaymentCheck.RefNumber. Documented in Consolibyte's
 *  qbXML schema and confirmed in QB's UI (the "No." field on the Bill Payment
 *  screen accepts 11 chars max). Exceeding it produces a schema validation
 *  error from QB. Our Convera flow uses wire confirmation codes like
 *  "OTR6607568" (10 chars) — always fits. */
const BILL_PAYMENT_CHECK_REF_NUMBER_MAX = 11;

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
 *  - Multiple <RefNumber> elements (repeatable) filter for bills matching ANY of them.
 *    The initial implementation used <RefNumberList> based on a misread of a schema
 *    excerpt — QB Desktop 2020 Pro rejected that with HRESULT 0x80040400 (Aug 2026).
 *  - Matching is case-INSENSITIVE by default. Use RefNumberCaseSensitive
 *    instead if we ever need case sensitivity (we don't today).
 *  - IncludeLineItems=false because we only need the header (RefNumber, TxnID,
 *    EditSequence). Avoids QB pulling line detail we won't consume.
 */
export function buildBillQueryRq(input: BillQueryRqInput): string {
  const hasTxnIds = (input.txnIds?.length ?? 0) > 0;
  const hasRefs = (input.refNumbers?.length ?? 0) > 0;
  const hasIterator = !!input.entityVendorName || !!input.fromTxnDate || !!input.toTxnDate;
  const modeCount = (hasTxnIds ? 1 : 0) + (hasRefs ? 1 : 0) + (hasIterator ? 1 : 0);
  if (modeCount === 0) {
    throw new Error('buildBillQueryRq: supply txnIds OR refNumbers OR entityVendorName/date-range (iterator mode)');
  }
  if (modeCount > 1) {
    throw new Error('buildBillQueryRq: txnIds, refNumbers, and iterator filters are mutually exclusive per the qbXML XSD choice group');
  }
  if (input.requestId) assertAscii('requestId', input.requestId);
  const attrs = input.requestId
    ? ` requestID="${xmlEscape(input.requestId)}"`
    : '';
  const parts: string[] = [`<BillQueryRq${attrs}>`];

  if (hasTxnIds) {
    (input.txnIds as string[]).forEach((t, i) => assertAscii(`txnIds[${i}]`, t));
    for (const txnId of input.txnIds as string[]) {
      parts.push(`  <TxnID>${xmlEscape(txnId)}</TxnID>`);
    }
    if (input.maxReturned != null) {
      parts.push(`  <MaxReturned>${input.maxReturned}</MaxReturned>`);
    }
  } else if (hasRefs) {
    (input.refNumbers as string[]).forEach((r, i) => assertAscii(`refNumbers[${i}]`, r));
    for (const ref of input.refNumbers as string[]) {
      parts.push(`  <RefNumber>${xmlEscape(ref)}</RefNumber>`);
    }
    if (input.maxReturned != null) {
      parts.push(`  <MaxReturned>${input.maxReturned}</MaxReturned>`);
    }
  } else {
    // Iterator mode per qbXML 13.0 XSD (BillQueryRq). Element ordering:
    //   FILTERS (ModifiedDateRangeFilter → TxnDateRangeFilter → EntityFilter
    //            → PaidStatus → CurrencyFilter)
    //   → MaxReturned? → IncludeLineItems? → OwnerID*
    // ModifiedDateRangeFilter comes BEFORE TxnDateRangeFilter per XSD.
    if (input.fromModifiedDate || input.toModifiedDate) {
      parts.push('  <ModifiedDateRangeFilter>');
      if (input.fromModifiedDate) {
        assertAscii('fromModifiedDate', input.fromModifiedDate);
        parts.push(`    <FromModifiedDate>${xmlEscape(input.fromModifiedDate)}</FromModifiedDate>`);
      }
      if (input.toModifiedDate) {
        assertAscii('toModifiedDate', input.toModifiedDate);
        parts.push(`    <ToModifiedDate>${xmlEscape(input.toModifiedDate)}</ToModifiedDate>`);
      }
      parts.push('  </ModifiedDateRangeFilter>');
    }
    if (input.fromTxnDate || input.toTxnDate) {
      parts.push('  <TxnDateRangeFilter>');
      if (input.fromTxnDate) {
        assertAscii('fromTxnDate', input.fromTxnDate);
        parts.push(`    <FromTxnDate>${xmlEscape(input.fromTxnDate)}</FromTxnDate>`);
      }
      if (input.toTxnDate) {
        assertAscii('toTxnDate', input.toTxnDate);
        parts.push(`    <ToTxnDate>${xmlEscape(input.toTxnDate)}</ToTxnDate>`);
      }
      parts.push('  </TxnDateRangeFilter>');
    }
    if (input.entityVendorName) {
      assertAscii('entityVendorName', input.entityVendorName);
      parts.push('  <EntityFilter>');
      parts.push(`    <FullName>${xmlEscape(input.entityVendorName)}</FullName>`);
      parts.push('  </EntityFilter>');
    }
    if (input.maxReturned != null) {
      parts.push(`  <MaxReturned>${input.maxReturned}</MaxReturned>`);
    }
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

  assertAscii('vendorName', input.vendorName);
  assertAscii('apAccountName', apAccount);
  assertAscii('defaultExpenseAccountName', defaultExpenseAccount);
  assertAscii('txnDate', input.txnDate);
  if (input.dueDate) assertAscii('dueDate', input.dueDate);
  assertAscii('refNumber', input.refNumber);
  if (input.memo) assertAscii('memo', input.memo);
  if (input.requestId) assertAscii('requestId', input.requestId);
  input.lines.forEach((line, i) => {
    if (line.memo) assertAscii(`lines[${i}].memo`, line.memo);
    if (line.expenseAccountName) assertAscii(`lines[${i}].expenseAccountName`, line.expenseAccountName);
  });

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

/** Build a <CheckAddRq> element.
 *
 * Direct-expense check (bank → expense) with no A/P Bill involved. Used by
 * the passthrough flow (Lucien C Pinto → Administration salaries) where the
 * accountant wants the payment recorded as an immediate expense rather than
 * pushed through A/P.
 *
 * qbXML element ordering inside <CheckAdd> per QB SDK v13 is STRICT (QB
 * rejects out-of-order children with a schema error):
 *
 *   AccountRef → PayeeEntityRef → RefNumber? → TxnDate → Memo? →
 *   Address? → IsToBePrinted? → IsTaxIncluded? → SalesTaxCodeRef? →
 *   ExpenseLineAdd+
 *
 * We only emit fields we use. ItemLineAdd (for inventory) is intentionally
 * out of scope — direct-expense is the only use case today.
 *
 * ExpenseLineAdd.Amount is entered as POSITIVE. QB debits the expense
 * account and credits the bank account for the sum of all line amounts.
 * Same convention as BillAddRq's ExpenseLineAdd.
 */
export function buildCheckAddRq(input: CheckAddRqInput): string {
  if (input.lines.length === 0) {
    throw new Error('buildCheckAddRq: at least one line required');
  }

  assertAscii('bankAccountName', input.bankAccountName);
  assertAscii('payeeVendorName', input.payeeVendorName);
  assertAscii('txnDate', input.txnDate);
  if (input.refNumber) assertAscii('refNumber', input.refNumber);
  if (input.memo) assertAscii('memo', input.memo);
  if (input.requestId) assertAscii('requestId', input.requestId);
  input.lines.forEach((line, i) => {
    assertAscii(`lines[${i}].expenseAccountName`, line.expenseAccountName);
    if (line.memo) assertAscii(`lines[${i}].memo`, line.memo);
  });

  const attrs = input.requestId
    ? ` requestID="${xmlEscape(input.requestId)}"`
    : '';
  const parts: string[] = [`<CheckAddRq${attrs}>`, '  <CheckAdd>'];

  // AccountRef (bank)
  parts.push('    <AccountRef>');
  parts.push(`      <FullName>${xmlEscape(input.bankAccountName)}</FullName>`);
  parts.push('    </AccountRef>');

  // PayeeEntityRef
  parts.push('    <PayeeEntityRef>');
  parts.push(`      <FullName>${xmlEscape(input.payeeVendorName)}</FullName>`);
  parts.push('    </PayeeEntityRef>');

  // RefNumber (optional, before TxnDate per XSD ordering)
  if (input.refNumber) {
    parts.push(`    <RefNumber>${xmlEscape(input.refNumber)}</RefNumber>`);
  }

  // TxnDate
  parts.push(`    <TxnDate>${xmlEscape(input.txnDate)}</TxnDate>`);

  // Memo (optional)
  if (input.memo) {
    parts.push(`    <Memo>${xmlEscape(input.memo)}</Memo>`);
  }

  // IsToBePrinted (optional)
  if (input.isToBePrinted !== undefined) {
    parts.push(`    <IsToBePrinted>${input.isToBePrinted ? 'true' : 'false'}</IsToBePrinted>`);
  }

  // ExpenseLineAdd (1..N)
  for (const line of input.lines) {
    parts.push('    <ExpenseLineAdd>');
    parts.push('      <AccountRef>');
    parts.push(`        <FullName>${xmlEscape(line.expenseAccountName)}</FullName>`);
    parts.push('      </AccountRef>');
    parts.push(`      <Amount>${fmtAmount(line.amount)}</Amount>`);
    if (line.memo) {
      parts.push(`      <Memo>${xmlEscape(line.memo)}</Memo>`);
    }
    parts.push('    </ExpenseLineAdd>');
  }

  parts.push('  </CheckAdd>');
  parts.push('</CheckAddRq>');
  return parts.join('\n');
}

/** Build a <BillPaymentCheckAddRq> element.
 *
 * qbXML element ordering inside <BillPaymentCheckAdd> is STRICT (same rules
 * as BillAdd — QB rejects out-of-order children with a schema error). Locked
 * order:
 *
 *    PayeeEntityRef → APAccountRef → TxnDate → BankAccountRef →
 *    RefNumber → Memo → IsToBePrinted → AppliedToTxnAdd+
 *
 * Inside <AppliedToTxnAdd>, also strict:
 *
 *    TxnID → PaymentAmount → DiscountAmount → DiscountAccountRef →
 *    DiscountClassRef → SetCredit*
 *
 * Inside <SetCredit>:
 *
 *    CreditTxnID → AppliedAmount → Override?
 *
 * Two order-related tests lock these — do not rearrange without updating
 * both tests AND re-verifying against qbXML 13.0 spec / a live QB.
 *
 * ONE PayeeEntityRef per BillPaymentCheck: this element models a single
 * check to a single vendor, covering N of that vendor's bills. If a Convera
 * wire ever covers bills for multiple vendors (rare — routing is per
 * beneficiary), the caller enqueues one job per (vendor, wire) pair with
 * the same TxnDate + BankAccount + RefNumber. Not a builder concern.
 *
 * PaymentAmount is entered as POSITIVE — the amount OF the payment applied
 * to this bill. QB reduces the bill's outstanding balance by that amount
 * and credits the bank account for the sum of all PaymentAmounts.
 *
 * DiscountAmount + DiscountAccountRef go together: if DiscountAmount is
 * provided without an account, QB has nowhere to post the discount and the
 * request fails. Builder catches this at input-validation time with a
 * useful error rather than letting it round-trip to QB.
 *
 * SetCredit blocks apply existing vendor credits (from prior overpayments
 * or vendor-issued credits) toward the same bill. Not used in the Convera
 * MVP flow; supported for a future accountant-triggered payment path.
 *
 * See constants.ts for KEY_POINT_CHECKING and WU_HOLDING (bank account
 * paths used by Convera and direct-disbursement flows respectively).
 * See GOTCHAS.md Session 3 for RefNumber length rationale and remaining
 * questions for Aug 9 live testing.
 */
/** Valid ActiveStatus values per qbXML 13.0 XSD. Used to catch typos at build
 *  time (QB rejects invalid values with a schema error). */
const VALID_ACTIVE_STATUS = new Set(['ActiveOnly', 'InactiveOnly', 'All']);

/** Build an <AccountQueryRq> element.
 *
 * Enumerates accounts from QB Desktop's chart of accounts for discovery
 * (bank / A/P / expense account FullNames that plug into other requests).
 * See types.ts / AccountQueryRqInput for the "why".
 *
 * qbXML element ordering inside the iterator branch is STRICT:
 *
 *    MaxReturned? → ActiveStatus? → FromModifiedDate? → ToModifiedDate? →
 *    (NameFilter | NameRangeFilter)? → AccountType* →
 *    IncludeRetElement* → OwnerID*
 *
 * We only expose the fields the discovery use case needs — MaxReturned,
 * ActiveStatus, AccountType filter. NameFilter and per-field include-list
 * would go here if a future caller wants finer control.
 *
 * Returns EVERY field on AccountRet by default (no IncludeRetElement filter);
 * ParsedAccountQueryRs surfaces just the header ones we care about, so the
 * extra bytes are only paid on the wire, not in DB.
 */
export function buildAccountQueryRq(input: AccountQueryRqInput = {}): string {
  if (input.requestId) assertAscii('requestId', input.requestId);
  if (input.activeStatus && !VALID_ACTIVE_STATUS.has(input.activeStatus)) {
    throw new Error(
      `buildAccountQueryRq: activeStatus must be one of ${Array.from(VALID_ACTIVE_STATUS).join(', ')}, ` +
        `got '${input.activeStatus}'.`,
    );
  }
  if (input.accountTypes) {
    input.accountTypes.forEach((t, i) => assertAscii(`accountTypes[${i}]`, t));
  }
  const attrs = input.requestId
    ? ` requestID="${xmlEscape(input.requestId)}"`
    : '';
  const parts: string[] = [`<AccountQueryRq${attrs}>`];
  if (input.maxReturned != null) {
    parts.push(`  <MaxReturned>${input.maxReturned}</MaxReturned>`);
  }
  // Default to All when no filter supplied — discovery use case wants inactive
  // accounts too (historical bills may reference them).
  parts.push(`  <ActiveStatus>${input.activeStatus ?? 'All'}</ActiveStatus>`);
  if (input.accountTypes && input.accountTypes.length > 0) {
    for (const t of input.accountTypes) {
      parts.push(`  <AccountType>${xmlEscape(t)}</AccountType>`);
    }
  }
  parts.push('</AccountQueryRq>');
  return parts.join('\n');
}

/** Build a <VendorQueryRq> element.
 *
 * Enumerates vendors from QB Desktop's vendor list. Purpose: pre-batch
 * verification that every payment_profiles.qb_vendor_name we're about to
 * reference in bill_pmt_add / bill_add actually exists in QB — catches drift
 * from accountant renames and prevents statusCode=3140 "Object not found"
 * mid-batch failures. See types.ts / VendorQueryRqInput for full rationale.
 *
 * qbXML element ordering inside the iterator branch:
 *
 *    MaxReturned? → ActiveStatus? → FromModifiedDate? → ToModifiedDate? →
 *    (NameFilter | NameRangeFilter)? → CurrencyFilter? →
 *    IncludeRetElement* → OwnerID*
 *
 * We expose only MaxReturned + ActiveStatus. Name filters and per-field
 * include-lists would go here if a future caller needs finer control.
 * Returns EVERY field on VendorRet by default; ParsedVendorQueryRs surfaces
 * just Name/CompanyName/IsActive/ListID.
 */
export function buildVendorQueryRq(input: VendorQueryRqInput = {}): string {
  if (input.requestId) assertAscii('requestId', input.requestId);
  if (input.activeStatus && !VALID_ACTIVE_STATUS.has(input.activeStatus)) {
    throw new Error(
      `buildVendorQueryRq: activeStatus must be one of ${Array.from(VALID_ACTIVE_STATUS).join(', ')}, ` +
        `got '${input.activeStatus}'.`,
    );
  }
  const attrs = input.requestId
    ? ` requestID="${xmlEscape(input.requestId)}"`
    : '';
  const parts: string[] = [`<VendorQueryRq${attrs}>`];
  if (input.maxReturned != null) {
    parts.push(`  <MaxReturned>${input.maxReturned}</MaxReturned>`);
  }
  parts.push(`  <ActiveStatus>${input.activeStatus ?? 'All'}</ActiveStatus>`);
  parts.push('</VendorQueryRq>');
  return parts.join('\n');
}

export function buildBillPaymentCheckAddRq(
  input: BillPaymentCheckAddRqInput,
): string {
  if (input.applications.length === 0) {
    throw new Error(
      'buildBillPaymentCheckAddRq: at least one application required',
    );
  }
  if (
    input.refNumber != null &&
    input.refNumber.length > BILL_PAYMENT_CHECK_REF_NUMBER_MAX
  ) {
    throw new Error(
      `buildBillPaymentCheckAddRq: refNumber "${input.refNumber}" exceeds ` +
        `QB's ${BILL_PAYMENT_CHECK_REF_NUMBER_MAX}-char BillPaymentCheck.RefNumber limit ` +
        `(actual: ${input.refNumber.length}). Use the wire confirmation code, ` +
        `not the invoice number.`,
    );
  }
  for (const app of input.applications) {
    if (app.discountAmount != null && !app.discountAccountName) {
      throw new Error(
        `buildBillPaymentCheckAddRq: application for billTxnId ` +
          `"${app.billTxnId}" has discountAmount but no discountAccountName. ` +
          `QB requires the discount account when a discount is applied.`,
      );
    }
  }

  const apAccount = input.apAccountName ?? DEFAULT_AP_ACCOUNT;

  assertAscii('payeeVendorName', input.payeeVendorName);
  assertAscii('apAccountName', apAccount);
  assertAscii('txnDate', input.txnDate);
  assertAscii('bankAccountName', input.bankAccountName);
  if (input.refNumber) assertAscii('refNumber', input.refNumber);
  if (input.memo) assertAscii('memo', input.memo);
  if (input.requestId) assertAscii('requestId', input.requestId);
  input.applications.forEach((app, i) => {
    assertAscii(`applications[${i}].billTxnId`, app.billTxnId);
    if (app.discountAccountName) assertAscii(`applications[${i}].discountAccountName`, app.discountAccountName);
    if (app.discountClassName) assertAscii(`applications[${i}].discountClassName`, app.discountClassName);
    (app.setCredits || []).forEach((sc, j) => {
      assertAscii(`applications[${i}].setCredits[${j}].creditTxnId`, sc.creditTxnId);
    });
  });

  const attrs = input.requestId
    ? ` requestID="${xmlEscape(input.requestId)}"`
    : '';

  const parts: string[] = [
    `<BillPaymentCheckAddRq${attrs}>`,
    '  <BillPaymentCheckAdd>',
  ];

  // PayeeEntityRef
  parts.push('    <PayeeEntityRef>');
  parts.push(
    `      <FullName>${xmlEscape(input.payeeVendorName)}</FullName>`,
  );
  parts.push('    </PayeeEntityRef>');

  // APAccountRef
  parts.push('    <APAccountRef>');
  parts.push(`      <FullName>${xmlEscape(apAccount)}</FullName>`);
  parts.push('    </APAccountRef>');

  // TxnDate
  parts.push(`    <TxnDate>${xmlEscape(input.txnDate)}</TxnDate>`);

  // BankAccountRef
  parts.push('    <BankAccountRef>');
  parts.push(
    `      <FullName>${xmlEscape(input.bankAccountName)}</FullName>`,
  );
  parts.push('    </BankAccountRef>');

  // (IsToBePrinted | RefNumber) — REQUIRED choice per QB Desktop's qbXML v16.0
  // schema. Exactly ONE must appear at this position (before Memo). Discovered
  // 2026-08-12 accountant live test: without either, QB emits
  //   "Element 'AppliedToTxnAdd' is not valid for content model:
  //    (PayeeEntityRef, APAccountRef?, TxnDate?, BankAccountRef,
  //     (IsToBePrinted|RefNumber), Memo?, ExchangeRate?, ExternalGUID?, AppliedToTxnAdd+)"
  //
  // Selection order:
  //  1. Caller-supplied refNumber wins (Convera wire confirmation code).
  //  2. Else caller-supplied isToBePrinted.
  //  3. Else default IsToBePrinted=false — Convera wires and ACH transfers are
  //     never printed checks; false is the correct default for our flows.
  if (input.refNumber) {
    parts.push(`    <RefNumber>${xmlEscape(input.refNumber)}</RefNumber>`);
  } else if (input.isToBePrinted != null) {
    parts.push(
      `    <IsToBePrinted>${input.isToBePrinted ? 'true' : 'false'}</IsToBePrinted>`,
    );
  } else {
    parts.push('    <IsToBePrinted>false</IsToBePrinted>');
  }

  // Memo (optional) — MUST come AFTER the (IsToBePrinted|RefNumber) choice per
  // the schema sequence. Earlier iterations placed IsToBePrinted after Memo,
  // which QB Xerces rejected with the same content-model error above.
  if (input.memo) {
    parts.push(`    <Memo>${xmlEscape(input.memo)}</Memo>`);
  }

  // AppliedToTxnAdd (required, repeatable)
  for (const app of input.applications) {
    parts.push('    <AppliedToTxnAdd>');
    parts.push(`      <TxnID>${xmlEscape(app.billTxnId)}</TxnID>`);
    parts.push(
      `      <PaymentAmount>${fmtAmount(app.paymentAmount)}</PaymentAmount>`,
    );
    if (app.discountAmount != null) {
      parts.push(
        `      <DiscountAmount>${fmtAmount(app.discountAmount)}</DiscountAmount>`,
      );
      parts.push('      <DiscountAccountRef>');
      parts.push(
        `        <FullName>${xmlEscape(app.discountAccountName!)}</FullName>`,
      );
      parts.push('      </DiscountAccountRef>');
      if (app.discountClassName) {
        parts.push('      <DiscountClassRef>');
        parts.push(
          `        <FullName>${xmlEscape(app.discountClassName)}</FullName>`,
        );
        parts.push('      </DiscountClassRef>');
      }
    }
    if (app.setCredits && app.setCredits.length > 0) {
      for (const sc of app.setCredits) {
        parts.push('      <SetCredit>');
        parts.push(
          `        <CreditTxnID>${xmlEscape(sc.creditTxnId)}</CreditTxnID>`,
        );
        parts.push(
          `        <AppliedAmount>${fmtAmount(sc.appliedAmount)}</AppliedAmount>`,
        );
        if (sc.override != null) {
          parts.push(
            `        <Override>${sc.override ? 'true' : 'false'}</Override>`,
          );
        }
        parts.push('      </SetCredit>');
      }
    }
    parts.push('    </AppliedToTxnAdd>');
  }

  parts.push('  </BillPaymentCheckAdd>');
  parts.push('</BillPaymentCheckAddRq>');
  return parts.join('\n');
}
