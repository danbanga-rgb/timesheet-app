// qbWrite executor — invariant coverage.
//
// Every invariant in ../INVARIANTS.md gets at least one test here. Currently
// most are `it.todo` — implementations land per-commit and un-skip their
// corresponding test as they go.
//
// If you're adding a new invariant, add its it.todo BEFORE implementation.
// If you're implementing, un-skip and make green.
// If you're deleting a test — you're deleting the rule. Don't.

import { describe, it, expect } from 'vitest';
import { validateIntent, executeIntents } from '../execute';
import type { PayBillIntent, CreateBillIntent, CheckExpenseIntent } from '../types';

// ─── Baseline fixtures — extend/override in individual tests ────────────────

const basePayBill: PayBillIntent = {
  kind: 'pay_bill',
  auditTag: 'test-fixture',
  payeeVendorName: 'Bimosoft - Amar Pljevljak',
  bankAccountName: '12000 - WU Holding',
  txnDate: '2026-08-15',
  refNumber: 'OTR6607568',
  memo: 'Convera wire OTR6607568',
  applications: [{ billTxnId: '12006-1196864828', paymentAmount: 6336 }],
  sourceConveraTxnId: 934,
};

const baseCreateBill: CreateBillIntent = {
  kind: 'create_bill',
  auditTag: 'test-fixture',
  vendorName: 'Flawless APPS LLC',
  txnDate: '2026-07-31',
  dueDate: '2026-09-15',
  refNumber: 'INV 12',
  memo: 'July 2026 — 77h @ $125 — Rumiya — INV 12',
  lines: [{ amount: 9625, memo: 'Jul 2026 — 77h @ $125 — Rumiya — INV 12' }],
  sourceInvoiceIds: [229],
};

const baseCheckExpense: CheckExpenseIntent = {
  kind: 'check_expense',
  auditTag: 'test-fixture',
  bankAccountName: '10100 - Key Point Checking',
  payeeVendorName: 'Lucien C Pinto',
  txnDate: '2026-08-13',
  memo: 'Intuit passthrough',
  lines: [{ expenseAccountName: 'Payroll Expenses:Administration salaries', amount: 400 }],
  sourceIngestEventId: 76,
};

// ─── Scaffold sanity — passes today ─────────────────────────────────────────

describe('scaffold', () => {
  it('validateIntent returns null for a well-formed pay_bill (scaffold no-op)', () => {
    expect(validateIntent(basePayBill)).toBeNull();
  });
  it('executeIntents returns per-intent results (scaffold no-op)', async () => {
    const r = await executeIntents({} as never, [basePayBill]);
    expect(r.jobIds).toEqual([null]);
    expect(r.rejected).toEqual([]);
    expect(r.skippedDuplicate).toEqual([]);
  });
});

// ─── Builder-layer invariants (INVARIANTS #1–10) ────────────────────────────

describe('INVARIANTS #1–10 (qbXML builder-layer)', () => {
  it.todo('#1  ASCII-only — non-ASCII in payeeVendorName / memo / refNumber rejects');
  it.todo('#2  element ordering strict per SDK 13 XSD — enforced by underlying builders (integration)');
  it.todo('#3  amounts formatted via fmtAmount (2dp) in the emitted qbXML');
  it.todo('#4  empty inputs — omitted memo does NOT emit <Memo></Memo>');
  it.todo('#5  BillPmtCheck RefNumber max 11 chars — 12+ rejects, 11 accepted, boundary tested');
  it.todo('#6  DiscountAmount requires DiscountAccountRef — set without account rejects');
  it.todo('#7  XML escape order — &, then <, >, \", \'');
  it.todo('#8  BillQueryRq uses repeated <RefNumber> (verified in enqueue path if we ever call it)');
  it.todo('#9  IncludeLineItems defaults false (query-side; N/A to executor but affirms parity)');
  it.todo('#10 Unicode diacritics pass through untouched (assuming ASCII rule #1 passes on names via qb_mirror snapshot)');
});

// ─── Domain / persistence invariants (INVARIANTS #11–19) ───────────────────

describe('INVARIANTS #11–19 (domain / persistence)', () => {
  it.todo('#11 vendor-scoped TxnID resolution — application billTxnId must belong to payeeVendorName in qb_mirror');
  it.todo('#12 reconciler refHit requirement — executor does NOT create pay_bill intents for amount-only matches (contract with reconciler)');
  it.todo('#13 normalizeRef stacked INV — refNumber comparison against qb_mirror uses normalizeRef');
  it.todo('#14 payload contract via validatePayload — every enqueued qb_sync_jobs.payload passes validatePayload for its kind');
  it.todo('#15 umbrella-safe pay_bill persistence — Convera pay_bill payload includes sourceConveraTxnId so link table gets populated');
  it.todo('#16 sub-block stripping — N/A to executor (parser concern), affirmed by parsers test');
  it.todo('#17 sessionProgress — N/A to executor (WC concern)');
  it.todo('#18 idempotency: status=posted skips re-post — duplicate intents for same source ref get skippedDuplicate');
  it.todo('#19 (source, source_ref) UNIQUE — executor does not create duplicates for the same sourceInvoiceId / sourceConveraTxnId / sourceIngestEventId');
});

// ─── Data invariants (INVARIANTS #20–24) ───────────────────────────────────

describe('INVARIANTS #20–24 (data)', () => {
  it.todo('#20 offshore = 100% Convera — pay_bill for offshore vendor with bankAccount != WU_HOLDING rejects (or warns loudly)');
  it.todo('#21 Bimosoft always UK ALT — create_bill for a Bimosoft vendor without UK-ALT profile in the source rejects');
  it.todo('#22 invoice.paymentProfile is snapshot — executor accepts vendorName resolved from live profiles (input contract)');
  it.todo('#23 matcher_ignore cutoff — executor does not accept intents sourced from pre-cutoff invoices/transactions');
  it.todo('#24 pre_our_system cutoff — executor does not accept intents sourced from pre-cutoff Intuit events');
});

// ─── Process invariants (INVARIANTS #25–32) — mostly N/A to executor unit tests ─

describe('INVARIANTS #25–32 (process — mostly enforced at code-review time)', () => {
  it.todo('#25 probe first, codify second (process — enforced in PR review)');
  it.todo('#26 RLS on new tables (process — enforced in migration review)');
  it.todo('#27 state vs fresh fetch (orchestrator concern — verified in consumer tests)');
  it.todo('#28 extract before write (process — enforced in PR review)');
  it.todo('#29 scan existing helpers first (process — enforced in PR review)');
  it.todo('#30 verify beneficiary before unmatch (matcher concern — N/A to executor)');
  it.todo('#31 two-copy qbxml/ drift (deploy-time — enforced by pre-deploy sync script/CI)');
  it.todo('#32 QBWC smoke test at session start (WC concern — N/A to executor)');
});

// ─── qbWrite design constraints (INVARIANTS #33–36) ────────────────────────

describe('INVARIANTS #33–36 (qbWrite design constraints)', () => {
  it.todo('#33 atomic intents only — types accept only pay_bill / create_bill / check_expense; no compound');
  it.todo('#34 multi-vendor writes = N intents — one umbrella wire → N pay_bill intents; executor has no wire concept');
  it.todo('#35 source-agnostic executor — same execute() path handles Intuit / Convera / manual sources');
  it.todo('#36 verify via mirror after every push — executor writes an audit row that G8 silent-drop verifier can watch');
});

// ─── Consumer-checklist integration tests (post-scaffold) ──────────────────

describe('consumer-checklist integration (once G7/G7.5/G7.6 wire up)', () => {
  it.todo('Intuit push (G7) uses executor — no direct qb_sync_jobs.insert');
  it.todo('Intuit proactive create_bill (G7.5) uses executor for each Missing-QB-Bill Intuit invoice');
  it.todo('Convera proactive create_bill (G7.6) uses executor for each Missing-QB-Bill Convera invoice');
  it.todo('Convera batch pay (existing script, retrofit) uses executor');
});
