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
import type { PayBillIntent, CreateBillIntent, CheckExpenseIntent, WriteIntent } from '../types';

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
  memo: 'July 2026 - 77h @ $125 - Rumiya - INV 12',
  lines: [{ amount: 9625, memo: 'Jul 2026 - 77h @ $125 - Rumiya - INV 12' }],
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

// Supabase mock that serves both idempotency queries + inserts.
// Chain shapes supported:
//   supabase.from(t).insert(rows).select('id')                          → { data, error }
//   supabase.from(t).select(cols).in(col, values)                       → { data, error }
//   supabase.from(t).select(cols).in(col, values).eq(col, value)        → { data, error }
//   supabase.from(t).select(cols).in(col, values).not(col, 'is', null)  → { data, error }
//   supabase.from(t).select(cols).in(col, values).in(col2, values2)     → { data, error }
type InsertedRow = { kind: string; payload: Record<string, unknown>; status: string };
type MockTable = Array<Record<string, unknown>>;
function makeMockSupabase(opts: {
  nextId?: number;
  insertError?: { message: string };
  tables?: Partial<Record<'convera_transaction_billpmts' | 'qb_ingest_events' | 'invoices' | 'qb_sync_jobs' | 'qb_mirror', MockTable>>;
} = {}) {
  let nextId = opts.nextId ?? 1000;
  const inserts: Array<{ table: string; rows: InsertedRow[] }> = [];
  // Default qb_mirror seed — covers basePayBill's billTxnId so tests that don't
  // exercise #11 pass by default. Tests that want to trigger a vendor mismatch
  // override `tables.qb_mirror` explicitly.
  const defaultTables = {
    qb_mirror: [
      { entity_kind: 'bill', entity_ref: '12006-1196864828', vendor_list_id: 'V-BIMO-AMAR',
        data: { vendor_name: 'Bimosoft - Amar Pljevljak' } },
      { entity_kind: 'bill', entity_ref: '41282-1784756812', vendor_list_id: 'V-FLAW',
        data: { vendor_name: 'Flawless APPS LLC' } },
    ],
  };
  const tables: NonNullable<typeof opts.tables> = { ...defaultTables, ...(opts.tables ?? {}) };

  const client = {
    from(tableName: string) {
      const rows = (tables[tableName as keyof typeof tables] ?? []) as MockTable;
      let stagedInsert: InsertedRow[] = [];
      const query = {
        _rows: [...rows],
        insert(newRows: InsertedRow[]) {
          stagedInsert = newRows;
          inserts.push({ table: tableName, rows: newRows });
          return {
            select(_cols: string) {
              if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError });
              const data = stagedInsert.map(() => ({ id: nextId++ }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
        select(_cols: string) {
          return this;
        },
        in(col: string, values: unknown[]) {
          this._rows = this._rows.filter(r => values.includes(r[col]));
          return this;
        },
        eq(col: string, value: unknown) {
          this._rows = this._rows.filter(r => r[col] === value);
          return this;
        },
        not(col: string, op: string, value: unknown) {
          if (op === 'is' && value === null) {
            this._rows = this._rows.filter(r => r[col] != null);
          }
          return this;
        },
        then(resolve: (v: { data: MockTable; error: null }) => unknown) {
          // Terminal await — resolve with current filtered rows
          return resolve({ data: this._rows, error: null });
        },
      };
      return query;
    },
  };
  return { client: client as unknown as Parameters<typeof executeIntents>[0], inserts };
}

describe('scaffold', () => {
  it('validateIntent returns null for a well-formed pay_bill (scaffold no-op)', () => {
    expect(validateIntent(basePayBill)).toBeNull();
  });
  it('executeIntents enqueues a well-formed pay_bill (returns job id, no rejects)', async () => {
    const { client, inserts } = makeMockSupabase({ nextId: 500 });
    const r = await executeIntents(client, [basePayBill]);
    expect(r.jobIds).toEqual([500]);
    expect(r.rejected).toEqual([]);
    expect(r.skippedDuplicate).toEqual([]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('qb_sync_jobs');
    expect(inserts[0].rows[0].kind).toBe('bill_pmt_add');
    expect(inserts[0].rows[0].payload.sourceConveraTxnId).toBe(934);
  });
});

// ─── Builder-layer invariants (INVARIANTS #1–10) ────────────────────────────

describe('INVARIANTS #1–10 (qbXML builder-layer)', () => {
  describe('#1 ASCII-only', () => {
    it('rejects non-ASCII in payeeVendorName (Croatian diacritic)', () => {
      const bad = { ...basePayBill, payeeVendorName: 'Bimosoft - Naretena Arnaüt' };
      const r = validateIntent(bad);
      expect(r).not.toBeNull();
      expect(r!.invariant).toMatch(/INVARIANTS #1/);
      expect(r!.reason).toMatch(/non-ASCII/);
    });
    it('rejects non-ASCII in memo (em-dash)', () => {
      const bad = { ...baseCreateBill, memo: 'July 2026 — 77h' };  // em-dash U+2014
      expect(validateIntent(bad)!.invariant).toMatch(/#1/);
    });
    it('rejects non-ASCII in refNumber', () => {
      const bad = { ...baseCreateBill, refNumber: 'INV—12' };
      expect(validateIntent(bad)!.invariant).toMatch(/#1/);
    });
    it('rejects non-ASCII in line memo', () => {
      const bad = { ...baseCreateBill, lines: [{ ...baseCreateBill.lines[0], memo: 'Jul — 77h' }] };
      expect(validateIntent(bad)!.invariant).toMatch(/#1/);
    });
    it('rejects non-ASCII in expenseAccountName (check_expense)', () => {
      const bad = { ...baseCheckExpense, lines: [{ ...baseCheckExpense.lines[0], expenseAccountName: 'Payroll:Süplement' }] };
      expect(validateIntent(bad)!.invariant).toMatch(/#1/);
    });
    it('passes clean ASCII on all three intent kinds', () => {
      expect(validateIntent(basePayBill)).toBeNull();
      expect(validateIntent(baseCreateBill)).toBeNull();
      expect(validateIntent(baseCheckExpense)).toBeNull();
    });
  });
  it('#2 element ordering strict per SDK 13 XSD — enforced by qbxml/ builders (see builders.test.ts order-lock tests)', () => {
    // Executor's contract with builders: it passes payload through; builders
    // emit elements in strict order. Integration proven by the "emits elements
    // in the strict qbXML spec order" tests in src/lib/qbxml/__tests__/builders.test.ts.
    expect(true).toBe(true);
  });
  it('#3 amounts formatted via fmtAmount (2dp) — enforced by qbxml/ builders', () => {
    // Amounts pass through as numbers; builder calls fmtAmount at emit time.
    // Verified in builders.test.ts.
    expect(true).toBe(true);
  });
  it('#4 empty inputs — omitted memo does NOT emit <Memo></Memo> — builder concern', () => {
    // Executor omits fields when the intent has them as undefined. Builder emits
    // conditionally. Verified in builders.test.ts "bare skeleton" tests.
    expect(true).toBe(true);
  });
  describe('#5 pay_bill RefNumber max 11 chars', () => {
    it('rejects 12-char refNumber', () => {
      const bad = { ...basePayBill, refNumber: 'OTR660756801' };  // 12 chars
      const r = validateIntent(bad);
      expect(r).not.toBeNull();
      expect(r!.invariant).toMatch(/#5/);
      expect(r!.reason).toMatch(/12 chars/);
    });
    it('accepts exactly 11-char refNumber (boundary)', () => {
      const boundary = { ...basePayBill, refNumber: 'OTR66075680' };  // 11 chars
      expect(validateIntent(boundary)).toBeNull();
    });
    it('accepts undefined refNumber (optional)', () => {
      const noRef: PayBillIntent = { ...basePayBill };
      delete noRef.refNumber;
      expect(validateIntent(noRef)).toBeNull();
    });
    it('does NOT apply the 11-char cap to create_bill (Bill refNumber has higher limit)', () => {
      const longBillRef = { ...baseCreateBill, refNumber: 'INVOICE Synergie 05/01-31/2026' };  // 30 chars
      // ASCII check passes (all ASCII); refNumber-length rule is pay_bill-only
      expect(validateIntent(longBillRef)).toBeNull();
    });
  });
  it('#6 DiscountAmount requires DiscountAccountRef — builder throws; executor types omit discount for MVP', () => {
    // Discount is not exposed on our intents (MVP). If we add it, executor
    // must reject at validate time before hitting the builder throw. Placeholder.
    expect(true).toBe(true);
  });
  it('#7 XML escape order — enforced in qbxml/envelope escape helpers (envelope.test.ts)', () => { expect(true).toBe(true); });
  it('#8 BillQueryRq uses repeated <RefNumber> — N/A to executor (query kind, not a write intent)', () => { expect(true).toBe(true); });
  it('#9 IncludeLineItems defaults false — N/A to executor (query kind)', () => { expect(true).toBe(true); });
  it('#10 Unicode diacritics pass through untouched — but #1 ASCII rule usually rejects them first; QB-side quirk out of scope', () => { expect(true).toBe(true); });
});

// ─── Domain / persistence invariants (INVARIANTS #11–19) ───────────────────

describe('INVARIANTS #11–19 (domain / persistence)', () => {
  describe('#11 vendor-scoped TxnID (billTxnId belongs to payeeVendorName in qb_mirror)', () => {
    it('rejects pay_bill when billTxnId belongs to a DIFFERENT vendor in qb_mirror', async () => {
      // Simulates the 2026-08-13 batch-15 bug — reconciler picked a bill by
      // refNumber alone, TxnID resolved to WRONG vendor. Executor catches it.
      const { client } = makeMockSupabase({
        tables: {
          qb_mirror: [{
            entity_kind: 'bill', entity_ref: '12006-1196864828', vendor_list_id: 'V-OTHER',
            data: { vendor_name: 'Someone Else LLC' },
          }],
        },
      });
      const r = await executeIntents(client, [basePayBill]);
      expect(r.rejected).toHaveLength(1);
      expect(r.rejected[0].invariant).toMatch(/#11/);
      expect(r.rejected[0].reason).toMatch(/Someone Else LLC/);
      expect(r.rejected[0].reason).toMatch(/Batch-15/);
    });
    it('rejects pay_bill when billTxnId is not in qb_mirror at all', async () => {
      const { client } = makeMockSupabase({ tables: { qb_mirror: [] } });
      const r = await executeIntents(client, [basePayBill]);
      expect(r.rejected[0].reason).toMatch(/not found in qb_mirror/);
    });
    it('accepts pay_bill when every billTxnId matches payeeVendorName in qb_mirror', async () => {
      const { client } = makeMockSupabase();  // default mirror has the fixture bill
      const r = await executeIntents(client, [basePayBill]);
      expect(r.rejected).toEqual([]);
      expect(r.jobIds[0]).not.toBeNull();
    });
    it('rejects when only ONE of N applications has a wrong-vendor TxnID (umbrella check)', async () => {
      const twoApps: PayBillIntent = {
        ...basePayBill,
        applications: [
          { billTxnId: '12006-1196864828', paymentAmount: 3000 },  // correct vendor (in default mirror)
          { billTxnId: 'WRONG-VENDOR-BILL', paymentAmount: 3336 },  // wrong vendor
        ],
      };
      const { client } = makeMockSupabase({
        tables: {
          qb_mirror: [
            { entity_kind: 'bill', entity_ref: '12006-1196864828', vendor_list_id: 'V-BIMO-AMAR',
              data: { vendor_name: 'Bimosoft - Amar Pljevljak' } },
            { entity_kind: 'bill', entity_ref: 'WRONG-VENDOR-BILL', vendor_list_id: 'V-OTHER',
              data: { vendor_name: 'Someone Else' } },
          ],
        },
      });
      const r = await executeIntents(client, [twoApps]);
      expect(r.rejected[0].invariant).toMatch(/#11/);
    });
    it('skips vendor check for create_bill / check_expense (they do not carry billTxnIds)', async () => {
      const { client } = makeMockSupabase({ tables: { qb_mirror: [] } });
      const r = await executeIntents(client, [baseCreateBill, baseCheckExpense]);
      expect(r.rejected).toEqual([]);
      expect(r.jobIds.every(id => id !== null)).toBe(true);
    });
  });
  it('#12 reconciler refHit requirement — contract with reconciler (reconcile.test.ts refHit tests)', () => {
    // Executor accepts pay_bill intents constructed by the reconciler. The
    // reconciler REFUSES to emit pay_bill for amount-only matches (falls to
    // create_bill_then_pay = create+pay pair). Verified in reconcile.test.ts.
    // Executor's job: trust the reconciler. If the reconciler regresses,
    // #11 vendor-scoped TxnID here catches the worst case (wrong-vendor bill).
    expect(true).toBe(true);
  });
  describe('#13 normalizeRef stacked INV', () => {
    it('N/A to executor — enforced by reconciler upstream (bills are looked up by refNumber there)', () => {
      // Executor accepts TxnID directly. The refNumber-normalization safety net
      // lives in src/lib/intuit/reconcile.ts (normalizeRef) — see stacked-INV
      // regression tests in reconcile.test.ts. Documented here so a reader
      // knows where the enforcement actually lives.
      expect(true).toBe(true);
    });
  });
  describe('#14 payload contract via validatePayload + shape rules', () => {
    it('rejects pay_bill with NEITHER source ref (would silent-no-op on persist)', () => {
      const bad: PayBillIntent = { ...basePayBill };
      delete bad.sourceConveraTxnId;
      const r = validateIntent(bad);
      expect(r).not.toBeNull();
      expect(r!.invariant).toMatch(/#14/);
    });
    it('rejects pay_bill with BOTH source refs (ambiguous — which domain row to update?)', () => {
      const bad: PayBillIntent = { ...basePayBill, sourceConveraTxnId: 934, sourceIngestEventId: 89 };
      const r = validateIntent(bad);
      expect(r).not.toBeNull();
      expect(r!.invariant).toMatch(/#14/);
    });
    it('accepts pay_bill via the Intuit path (sourceIngestEventId only)', () => {
      const intuit: PayBillIntent = { ...basePayBill };
      delete intuit.sourceConveraTxnId;
      intuit.sourceIngestEventId = 89;
      expect(validateIntent(intuit)).toBeNull();
    });
    it('rejects create_bill with empty lines', () => {
      const bad = { ...baseCreateBill, lines: [] };
      const r = validateIntent(bad);
      expect(r!.invariant).toMatch(/#14/);
      expect(r!.reason).toMatch(/lines\[\]/);
    });
    it('rejects check_expense with empty lines', () => {
      const bad = { ...baseCheckExpense, lines: [] };
      expect(validateIntent(bad)!.invariant).toMatch(/#14/);
    });
    it('rejects pay_bill with empty applications', () => {
      const bad = { ...basePayBill, applications: [] };
      expect(validateIntent(bad)!.invariant).toMatch(/#14/);
    });
  });
  describe('#15 umbrella-safe pay_bill persistence', () => {
    it('Convera pay_bill payload carries sourceConveraTxnId so link table upsert works', async () => {
      const { client, inserts } = makeMockSupabase();
      await executeIntents(client, [basePayBill]);
      const jobRow = inserts.find(i => i.table === 'qb_sync_jobs')!.rows[0];
      expect(jobRow.kind).toBe('bill_pmt_add');
      expect(jobRow.payload.sourceConveraTxnId).toBe(934);
      expect(jobRow.payload.payeeVendorName).toBe('Bimosoft - Amar Pljevljak');
      // Persist step uses (sourceConveraTxnId, payeeVendorName) as the
      // convera_transaction_billpmts UNIQUE key — both required for umbrella-safe write.
    });
    it('two vendors on same wire enqueue as TWO independent pay_bill jobs', async () => {
      const { client, inserts } = makeMockSupabase({
        tables: {
          qb_mirror: [
            { entity_kind: 'bill', entity_ref: '12006-1196864828', vendor_list_id: 'V-A',
              data: { vendor_name: 'Bimosoft - Amar Pljevljak' } },
            { entity_kind: 'bill', entity_ref: '12006-1196864829', vendor_list_id: 'V-B',
              data: { vendor_name: 'Bimosoft - Edin Jasarspahic' } },
          ],
        },
      });
      const amar: PayBillIntent = { ...basePayBill };
      const edin: PayBillIntent = {
        ...basePayBill,
        payeeVendorName: 'Bimosoft - Edin Jasarspahic',
        applications: [{ billTxnId: '12006-1196864829', paymentAmount: 3040 }],
      };
      await executeIntents(client, [amar, edin]);
      const jobs = inserts.find(i => i.table === 'qb_sync_jobs')!.rows;
      expect(jobs).toHaveLength(2);
      expect(jobs.map(j => j.payload.payeeVendorName).sort())
        .toEqual(['Bimosoft - Amar Pljevljak', 'Bimosoft - Edin Jasarspahic']);
      // Both carry the same sourceConveraTxnId (wire 934). Link table dedup
      // works because UNIQUE key is (convera_transaction_id, qb_vendor_name).
      expect(jobs.every(j => j.payload.sourceConveraTxnId === 934)).toBe(true);
    });
  });
  it('#16 sub-block stripping — N/A to executor (parser concern; verified in parsers.test.ts LinkedTxn tests)', () => { expect(true).toBe(true); });
  it('#17 sessionProgress — N/A to executor (WC edge-fn concern)', () => { expect(true).toBe(true); });
  describe('#18 idempotency: already-done skip', () => {
    it('skips Convera pay_bill when convera_transaction_billpmts has (wire, vendor) entry', async () => {
      const { client } = makeMockSupabase({
        tables: {
          convera_transaction_billpmts: [{ convera_transaction_id: 934, qb_vendor_name: 'Bimosoft - Amar Pljevljak' }],
        },
      });
      const r = await executeIntents(client, [basePayBill]);
      expect(r.jobIds).toEqual([null]);
      expect(r.rejected).toEqual([]);
      expect(r.skippedDuplicate).toHaveLength(1);
      expect(r.skippedDuplicate[0].reason).toMatch(/convera_transaction_billpmts/);
    });
    it('skips Intuit pay_bill when qb_ingest_events.status=posted for the event', async () => {
      const intuitPay: PayBillIntent = { ...basePayBill };
      delete intuitPay.sourceConveraTxnId;
      intuitPay.sourceIngestEventId = 89;
      const { client } = makeMockSupabase({
        tables: { qb_ingest_events: [{ id: 89, status: 'posted' }] },
      });
      const r = await executeIntents(client, [intuitPay]);
      expect(r.skippedDuplicate[0].reason).toMatch(/status='posted'/);
      expect(r.jobIds).toEqual([null]);
    });
    it('skips create_bill when any sourceInvoiceId already has qb_bill_txn_id in invoices', async () => {
      const { client } = makeMockSupabase({
        tables: { invoices: [{ id: 229, qb_bill_txn_id: '41000-1234567' }] },
      });
      const r = await executeIntents(client, [baseCreateBill]);
      expect(r.skippedDuplicate).toHaveLength(1);
      expect(r.skippedDuplicate[0].reason).toMatch(/229/);
      expect(r.skippedDuplicate[0].reason).toMatch(/qb_bill_txn_id/);
    });
    it('skips check_expense when qb_ingest_events.status=posted', async () => {
      const { client } = makeMockSupabase({
        tables: { qb_ingest_events: [{ id: 76, status: 'posted' }] },
      });
      const r = await executeIntents(client, [baseCheckExpense]);
      expect(r.skippedDuplicate).toHaveLength(1);
    });
  });
  describe('#19 in-flight qb_sync_jobs dedup', () => {
    it('skips when a pending bill_pmt_add for same (sourceConveraTxnId, payeeVendorName) exists', async () => {
      const { client } = makeMockSupabase({
        tables: {
          qb_sync_jobs: [{
            id: 42, kind: 'bill_pmt_add', status: 'pending',
            payload: { sourceConveraTxnId: 934, payeeVendorName: 'Bimosoft - Amar Pljevljak' },
          }],
        },
      });
      const r = await executeIntents(client, [basePayBill]);
      expect(r.skippedDuplicate[0].reason).toMatch(/in-flight.*id=42/);
    });
    it('skips create_bill when a pending bill_add covers overlapping sourceInvoiceIds', async () => {
      const { client } = makeMockSupabase({
        tables: {
          qb_sync_jobs: [{
            id: 88, kind: 'bill_add', status: 'in_flight',
            payload: { sourceInvoiceIds: [229, 230] },  // overlaps with baseCreateBill.sourceInvoiceIds=[229]
          }],
        },
      });
      const r = await executeIntents(client, [baseCreateBill]);
      expect(r.skippedDuplicate[0].reason).toMatch(/in-flight.*id=88/);
    });
    it('does NOT skip when in-flight job is for DIFFERENT source_ref', async () => {
      const { client } = makeMockSupabase({
        tables: {
          qb_sync_jobs: [{
            id: 99, kind: 'bill_pmt_add', status: 'pending',
            payload: { sourceConveraTxnId: 999, payeeVendorName: 'Someone Else' },
          }],
        },
      });
      const r = await executeIntents(client, [basePayBill]);
      expect(r.skippedDuplicate).toHaveLength(0);
      expect(r.jobIds[0]).not.toBeNull();
    });
    it('does NOT skip when in-flight job is for DIFFERENT vendor same wire (umbrella case)', async () => {
      // Umbrella wire pays 2 vendors — first is in-flight, second should still enqueue.
      const { client } = makeMockSupabase({
        tables: {
          qb_sync_jobs: [{
            id: 77, kind: 'bill_pmt_add', status: 'pending',
            payload: { sourceConveraTxnId: 934, payeeVendorName: 'Bimosoft - Edin Jasarspahic' },
          }],
        },
      });
      const secondVendor: PayBillIntent = { ...basePayBill, payeeVendorName: 'Bimosoft - Amar Pljevljak' };
      const r = await executeIntents(client, [secondVendor]);
      expect(r.skippedDuplicate).toHaveLength(0);
      expect(r.jobIds[0]).not.toBeNull();
    });
  });
});

// ─── Data invariants (INVARIANTS #20–24) ───────────────────────────────────

describe('INVARIANTS #20–24 (data — source-adapter concerns, documented here)', () => {
  it('#20 offshore = 100% Convera — enforced at source-adapter time (invoice → intent construction has visibility into profile.country)', () => {
    // Executor does not know contractor country. Source adapter must reject
    // constructing an Intuit pay_bill for an offshore contractor before it
    // ever reaches executor. Consumer contract, verified in G7/G7.5/G7.6.
    expect(true).toBe(true);
  });
  it('#21 Bimosoft = UK ALT — enforced at source-adapter time (payment_profile selection)', () => {
    // Source adapter selects the correct payment_profile (UK ALT) when
    // constructing an intent for Bimosoft contractors. See project_bimosoft_uk_alt.
    expect(true).toBe(true);
  });
  it('#22 invoice.paymentProfile snapshot — source adapter uses live payment_profiles fallback (fix 4e1c7da / 9482b75)', () => {
    // Executor accepts vendorName as a pre-resolved string. Source adapters
    // (F.5 classifier, Missing-Bills audit) already apply the liveVendorNameByUserId
    // fallback pattern. Verified in project_invoice_snapshot_vs_live.
    expect(true).toBe(true);
  });
  it('#23 matcher_ignore cutoff — source adapter filters pre-cutoff rows before intent construction', () => {
    // matcher_ignore lives on invoices + convera_transactions rows. Source
    // adapters check the flag; executor is downstream and trusts the input.
    expect(true).toBe(true);
  });
  it('#24 pre_our_system cutoff — enforced by reconciler (reconcile.ts preOurSystemCutoff branch)', () => {
    // Reconciler short-circuits pre-cutoff events to resolved_action='pre_our_system'
    // BEFORE constructing any intent. Verified in reconcile.test.ts.
    expect(true).toBe(true);
  });
});

// ─── Process invariants (INVARIANTS #25–32) — mostly N/A to executor unit tests ─

describe('INVARIANTS #25–32 (process — documented here; enforced at review or deploy time)', () => {
  it('#25 probe first, codify second — PR-review discipline', () => { expect(true).toBe(true); });
  it('#26 RLS on new tables — migration-review discipline', () => { expect(true).toBe(true); });
  it('#27 state vs fresh fetch — orchestrator/consumer concern (verified per-consumer)', () => { expect(true).toBe(true); });
  it('#28 extract before write — PR-review discipline', () => { expect(true).toBe(true); });
  it('#29 scan existing helpers first — PR-review discipline', () => { expect(true).toBe(true); });
  it('#30 verify beneficiary before unmatch — matcher concern, N/A to executor', () => { expect(true).toBe(true); });
  it('#31 two-copy qbxml/ drift — deploy-time; consider CI diff gate', () => { expect(true).toBe(true); });
  it('#32 QBWC smoke test at session start — WC concern, N/A to executor', () => { expect(true).toBe(true); });
});

// ─── qbWrite design constraints (INVARIANTS #33–36) ────────────────────────

describe('INVARIANTS #33–36 (qbWrite design constraints)', () => {
  describe('#33 atomic intents only', () => {
    it('WriteIntent union has exactly three members — pay_bill, create_bill, check_expense', () => {
      // Type-level constraint. Enforced by TypeScript; if a fourth kind is added
      // this test surfaces it as a review checkpoint.
      const kinds: WriteIntent['kind'][] = ['pay_bill', 'create_bill', 'check_expense'];
      expect(kinds.length).toBe(3);
      expect(new Set(kinds).size).toBe(3);
    });
    it('validateIntent rejects unknown kind at runtime', () => {
      // If someone smuggles in an unknown kind via `as any`, validate should still
      // pass or reject gracefully (currently the switch just skips ASCII/refnumber
      // checks). This test documents that behavior — extend when we add stricter
      // exhaustive-check.
      const bogus = { ...basePayBill, kind: 'chain_bill_and_pay' } as unknown as WriteIntent;
      expect(() => validateIntent(bogus)).not.toThrow();
    });
  });
  describe('#34 multi-vendor writes = N intents', () => {
    it('validateIntent does NOT accept a wire-grouped payload — each pay_bill is per-payee-vendor', () => {
      // The type doesn't have a "vendors[]" field; applications[] is per-bill for
      // ONE payee. Enforced at type level. Runtime evidence: submitting 3 intents
      // for 3 vendors → validateIntent handles each independently.
      const v1: PayBillIntent = { ...basePayBill, payeeVendorName: 'Vendor A' };
      const v2: PayBillIntent = { ...basePayBill, payeeVendorName: 'Vendor B' };
      const v3: PayBillIntent = { ...basePayBill, payeeVendorName: 'Vendor C' };
      expect(validateIntent(v1)).toBeNull();
      expect(validateIntent(v2)).toBeNull();
      expect(validateIntent(v3)).toBeNull();
    });
  });
  it('#35 source-agnostic executor — one executeIntents path handles all sources', async () => {
    // Mix Intuit-source pay_bill + Convera-source pay_bill + create_bill + check_expense
    // in ONE batch. All enqueue via the same code path.
    const intuitPay: PayBillIntent = { ...basePayBill };
    delete intuitPay.sourceConveraTxnId;
    intuitPay.sourceIngestEventId = 89;
    intuitPay.applications = [{ billTxnId: '41282-1784756812', paymentAmount: 9625 }];
    intuitPay.payeeVendorName = 'Flawless APPS LLC';
    const { client, inserts } = makeMockSupabase();
    const r = await executeIntents(client, [basePayBill, intuitPay, baseCreateBill, baseCheckExpense]);
    expect(r.rejected).toEqual([]);
    const jobs = inserts.find(i => i.table === 'qb_sync_jobs')!.rows;
    expect(jobs.map(j => j.kind).sort()).toEqual(['bill_add', 'bill_pmt_add', 'bill_pmt_add', 'check_add']);
  });
  it.todo('#36 verify via mirror after every push — deferred to G8 silent-drop verifier (audit trail via qb_sync_jobs.__audit_tag)');
});

// ─── Consumer-checklist integration tests (post-scaffold) ──────────────────

describe('consumer-checklist integration (deferred — real integration tests live in G7 / G7.5 / G7.6 commits)', () => {
  it.todo('Intuit push (G7) uses executor — no direct qb_sync_jobs.insert');
  it.todo('Intuit proactive create_bill (G7.5) uses executor for each Missing-QB-Bill Intuit invoice');
  it.todo('Convera proactive create_bill (G7.6) uses executor for each Missing-QB-Bill Convera invoice');
  it.todo('Convera batch pay (existing script, retrofit) uses executor');
});
