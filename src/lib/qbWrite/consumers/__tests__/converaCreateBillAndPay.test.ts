// converaCreateBillAndPay — Slice C-2/C-3 consumer tests.
//
// Verifies:
//  - single-invoice event, missing bill → bill_add + chained pay_bill
//    (single-slot __hydrate_bill_txn_id_from_dep marker)
//  - single-invoice event, bill already exists → direct pay_bill (no chain)
//  - multi-vendor umbrella (Bimosoft-style) → per-vendor fan into N pay chains
//  - same-vendor multi-invoice missing bills → single pay_bill with multi-slot
//    __hydrate_from_deps marker
//  - mixed sub-group (some existing, some missing) → pay_bill with real TxnIDs
//    for existing slots + hydration slots for missing
//  - is_settled defensive guard skips sub-groups with any already-paid bill
//  - wrong source / status / target skipped

import { describe, it, expect } from 'vitest';
import { pushConveraCreateBillAndPay } from '../converaCreateBillAndPay';

type Row = Record<string, unknown>;

function makeMockSupabase(tables: Record<string, Row[]>) {
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  let nextId = 9000;
  const client = {
    from(tableName: string) {
      const rows = (tables[tableName] ?? []) as Row[];
      const query = {
        _rows: [...rows],
        insert(newRows: Row[]) {
          inserts.push({ table: tableName, rows: newRows });
          const inserted = newRows.map(() => ({ id: nextId++ }));
          return {
            select() {
              return Promise.resolve({ data: inserted, error: null });
            },
          };
        },
        select() { return this; },
        in(col: string, values: unknown[]) {
          this._rows = this._rows.filter(r => values.includes(r[col]));
          return this;
        },
        eq(col: string, value: unknown) {
          this._rows = this._rows.filter(r => r[col] === value);
          return this;
        },
        not(col: string, op: string, value: unknown) {
          if (op === 'is' && value === null) this._rows = this._rows.filter(r => r[col] != null);
          return this;
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return resolve({ data: this._rows, error: null });
        },
      };
      return query;
    },
  };
  return { client: client as unknown as Parameters<typeof pushConveraCreateBillAndPay>[0], inserts };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const singleInvoiceEvent = {
  id: 300,
  source: 'convera',
  amount: 5000,
  counterparty_qb_vendor_list_id: 'V-LIIA',
  status: 'ready',
  target_qb_txn_kind: 'bill_pmt',
  matched_invoice_ids: [500],
  raw_data: { convera_transaction_id: 800 },
};

// 4 invoices, 4 vendors — Bimosoft-style multi-vendor umbrella.
const bimosoftUmbrellaEvent = {
  id: 310,
  source: 'convera',
  amount: 12000,
  counterparty_qb_vendor_list_id: 'V-BIMO-A',   // classifier's Pass 2 picks first invoice's vendor; consumer refans per invoice
  status: 'ready',
  target_qb_txn_kind: 'bill_pmt',
  matched_invoice_ids: [700, 701, 702, 703],
  raw_data: { convera_transaction_id: 810 },
};

// Same-vendor multi-invoice with all bills missing — needs multi-slot hydration.
const sameVendorMultiEvent = {
  id: 320,
  source: 'convera',
  amount: 10000,
  counterparty_qb_vendor_list_id: 'V-LIIA',
  status: 'ready',
  target_qb_txn_kind: 'bill_pmt',
  matched_invoice_ids: [520, 521],
  raw_data: { convera_transaction_id: 820 },
};

const converaTxns = [
  { id: 800, confirmation_number: 'CNF-A100', date_of_order: '2026-09-01' },
  { id: 810, confirmation_number: 'CNF-BIMO', date_of_order: '2026-09-01' },
  { id: 820, confirmation_number: 'CNF-A320', date_of_order: '2026-09-01' },
];

// invoice 500 missing bill; 501 has one; 520/521 missing bills (same vendor).
// 700-703 all missing bills, each a different vendor (Bimosoft).
const invoices = [
  { id: 500, user_id: 'U-LIIA', qb_bill_txn_id: null, total_amount: 5000, invoice_number: 'INV 58', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Liia' }, group_key: null },
  { id: 501, user_id: 'U-LIIA', qb_bill_txn_id: 'LIIA-EXISTING-BILL', total_amount: 5000, invoice_number: 'INV 59', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Liia' }, group_key: null },
  { id: 520, user_id: 'U-LIIA', qb_bill_txn_id: null, total_amount: 6000, invoice_number: 'INV 60', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Liia' }, group_key: null },
  { id: 521, user_id: 'U-LIIA', qb_bill_txn_id: null, total_amount: 4000, invoice_number: 'INV 61', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Liia' }, group_key: null },
  { id: 700, user_id: 'U-AMAR',   qb_bill_txn_id: null, total_amount: 3000, invoice_number: 'INV 1',  period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Bimosoft - Amar' },     group_key: null },
  { id: 701, user_id: 'U-ANELA',  qb_bill_txn_id: null, total_amount: 3000, invoice_number: 'INV 2',  period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Bimosoft - Anela' },    group_key: null },
  { id: 702, user_id: 'U-FADIL',  qb_bill_txn_id: null, total_amount: 3000, invoice_number: 'INV 3',  period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Bimosoft - Fadil' },    group_key: null },
  { id: 703, user_id: 'U-NARETENA', qb_bill_txn_id: null, total_amount: 3000, invoice_number: 'INV 4', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Bimosoft - Naretena' }, group_key: null },
];

const vendors = [
  { list_id: 'V-LIIA', name: 'Liia' },
  { list_id: 'V-BIMO-A',    name: 'Bimosoft - Amar' },
  { list_id: 'V-BIMO-AN',   name: 'Bimosoft - Anela' },
  { list_id: 'V-BIMO-F',    name: 'Bimosoft - Fadil' },
  { list_id: 'V-BIMO-N',    name: 'Bimosoft - Naretena' },
];

const bankAccounts = [
  { list_id: 'A-WU', full_name: 'BANK/CASH:Western Union Holding', account_type: 'Bank', is_active: true },
  { list_id: 'EXP-VENDOR-CONSULTANTS', full_name: 'Vendor Consultants', account_type: 'Expense', is_active: true },
];

const paymentProfiles = [
  { id: 33, user_id: 'U-LIIA',      qb_vendor_name: 'Liia',                 is_default: true, company_name: 'Liia PE' },
  { id: 34, user_id: 'U-AMAR',      qb_vendor_name: 'Bimosoft - Amar',      is_default: true, company_name: 'Bimosoft A' },
  { id: 35, user_id: 'U-ANELA',     qb_vendor_name: 'Bimosoft - Anela',     is_default: true, company_name: 'Bimosoft An' },
  { id: 36, user_id: 'U-FADIL',     qb_vendor_name: 'Bimosoft - Fadil',     is_default: true, company_name: 'Bimosoft F' },
  { id: 37, user_id: 'U-NARETENA',  qb_vendor_name: 'Bimosoft - Naretena',  is_default: true, company_name: 'Bimosoft N' },
];

const qbVendorMappings = [
  { qb_vendor_list_id: 'V-LIIA',    default_expense_account_list_id: 'EXP-VENDOR-CONSULTANTS' },
  { qb_vendor_list_id: 'V-BIMO-A',  default_expense_account_list_id: 'EXP-VENDOR-CONSULTANTS' },
  { qb_vendor_list_id: 'V-BIMO-AN', default_expense_account_list_id: 'EXP-VENDOR-CONSULTANTS' },
  { qb_vendor_list_id: 'V-BIMO-F',  default_expense_account_list_id: 'EXP-VENDOR-CONSULTANTS' },
  { qb_vendor_list_id: 'V-BIMO-N',  default_expense_account_list_id: 'EXP-VENDOR-CONSULTANTS' },
];

const profiles = [
  { id: 'U-LIIA', name: 'Liia Khaustova' },
  { id: 'U-AMAR', name: 'Amar Pljevljak' },
  { id: 'U-ANELA', name: 'Anela Kaltak' },
  { id: 'U-FADIL', name: 'Fadil Kalaca' },
  { id: 'U-NARETENA', name: 'Naretena Arnaut' },
];

function baseTables(overrides: Record<string, Row[]> = {}) {
  return {
    convera_transactions: converaTxns,
    invoices,
    qb_vendors: vendors,
    qb_accounts: bankAccounts,
    payment_profiles: paymentProfiles,
    qb_vendor_mappings: qbVendorMappings,
    profiles,
    qb_mirror: [],
    convera_transaction_billpmts: [],
    convera_transaction_invoices: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('pushConveraCreateBillAndPay', () => {
  it('no-op on empty input', async () => {
    const { client, inserts } = makeMockSupabase({});
    const r = await pushConveraCreateBillAndPay(client, []);
    expect(r.jobIds).toEqual([]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(inserts).toHaveLength(0);
  });

  it('single-invoice missing bill → bill_add + chained pay_bill with single-slot hydration', async () => {
    const { client, inserts } = makeMockSupabase(baseTables({
      qb_ingest_events: [singleInvoiceEvent],
    }));
    const r = await pushConveraCreateBillAndPay(client, [300], { auditTag: 'c2-test' });
    expect(r.chainedPayJobIds).toHaveLength(1);
    expect(r.billAddJobIds).toHaveLength(1);
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    const payInsert = jobInserts.find(i => (i.rows[0] as { kind: string }).kind === 'bill_pmt_add');
    expect(payInsert).toBeDefined();
    const payload = (payInsert!.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.payeeVendorName).toBe('Liia');
    expect(payload.bankAccountName).toBe('BANK/CASH:Western Union Holding');
    expect(payload.refNumber).toBe('CNF-A100');
    expect(payload.sourceConveraTxnId).toBe(800);
    // Single-slot: uses legacy __hydrate_bill_txn_id_from_dep marker for backward compat.
    expect(payload.__hydrate_bill_txn_id_from_dep).toBe(r.billAddJobIds[0]);
    expect(payload.__hydrate_from_deps).toBeUndefined();
    expect(payload.applications).toEqual([{ billTxnId: null, paymentAmount: 5000 }]);
  });

  it('single-invoice existing bill → direct pay_bill, no bill_add chain, no hydration', async () => {
    const existingBillEvent = { ...singleInvoiceEvent, id: 302, matched_invoice_ids: [501] };
    const { client, inserts } = makeMockSupabase(baseTables({
      qb_ingest_events: [existingBillEvent],
      qb_mirror: [{ entity_kind: 'bill', entity_ref: 'LIIA-EXISTING-BILL', is_settled: false }],
    }));
    const r = await pushConveraCreateBillAndPay(client, [302]);
    expect(r.chainedPayJobIds).toHaveLength(1);
    expect(r.billAddJobIds).toHaveLength(0);
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    const payInsert = jobInserts.find(i => (i.rows[0] as { kind: string }).kind === 'bill_pmt_add');
    const payload = (payInsert!.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.applications).toEqual([{ billTxnId: 'LIIA-EXISTING-BILL', paymentAmount: 5000 }]);
    expect(payload.__hydrate_bill_txn_id_from_dep).toBeUndefined();
    expect(payload.__hydrate_from_deps).toBeUndefined();
    expect((payInsert!.rows[0] as { depends_on: number[] }).depends_on).toEqual([]);
  });

  it('multi-vendor Bimosoft umbrella → fans per vendor, emits N pay_bill chains sharing sourceConveraTxnId', async () => {
    const { client, inserts } = makeMockSupabase(baseTables({
      qb_ingest_events: [bimosoftUmbrellaEvent],
    }));
    const r = await pushConveraCreateBillAndPay(client, [310]);
    expect(r.chainedPayJobIds).toHaveLength(4);   // one pay per vendor
    expect(r.billAddJobIds).toHaveLength(4);      // one bill_add per invoice
    const payInserts = inserts.filter(i => i.table === 'qb_sync_jobs' && (i.rows[0] as { kind: string }).kind === 'bill_pmt_add');
    expect(payInserts).toHaveLength(1);           // one insert call containing 4 rows
    const rowsInserted = payInserts[0].rows as Array<{ payload: Record<string, unknown> }>;
    expect(rowsInserted).toHaveLength(4);
    const payeeNames = rowsInserted.map(r => r.payload.payeeVendorName).sort();
    expect(payeeNames).toEqual([
      'Bimosoft - Amar', 'Bimosoft - Anela', 'Bimosoft - Fadil', 'Bimosoft - Naretena',
    ]);
    // All 4 pay_bills reference the same wire.
    for (const row of rowsInserted) {
      expect(row.payload.sourceConveraTxnId).toBe(810);
      expect(row.payload.refNumber).toBe('CNF-BIMO');
      expect(row.payload.applications).toHaveLength(1);
    }
  });

  it('same-vendor multi-invoice missing bills → single pay_bill with multi-slot __hydrate_from_deps', async () => {
    const { client, inserts } = makeMockSupabase(baseTables({
      qb_ingest_events: [sameVendorMultiEvent],
    }));
    const r = await pushConveraCreateBillAndPay(client, [320]);
    expect(r.chainedPayJobIds).toHaveLength(1);
    expect(r.billAddJobIds).toHaveLength(2);
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    const payInsert = jobInserts.find(i => (i.rows[0] as { kind: string }).kind === 'bill_pmt_add');
    const payload = (payInsert!.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.applications).toEqual([
      { billTxnId: null, paymentAmount: 6000 },
      { billTxnId: null, paymentAmount: 4000 },
    ]);
    // Multi-slot: uses __hydrate_from_deps, NOT the legacy single-slot marker.
    expect(payload.__hydrate_bill_txn_id_from_dep).toBeUndefined();
    expect(payload.__hydrate_from_deps).toBeDefined();
    const hydrateSlots = payload.__hydrate_from_deps as Array<{ depJobId: number; applicationIndex: number }>;
    expect(hydrateSlots).toHaveLength(2);
    expect(hydrateSlots.map(s => s.applicationIndex).sort()).toEqual([0, 1]);
    expect((payInsert!.rows[0] as { depends_on: number[] }).depends_on).toHaveLength(2);
  });

  it('is_settled guard: skips sub-group when any existing bill is already settled', async () => {
    const existingBillEvent = { ...singleInvoiceEvent, id: 303, matched_invoice_ids: [501] };
    const { client } = makeMockSupabase(baseTables({
      qb_ingest_events: [existingBillEvent],
      qb_mirror: [{ entity_kind: 'bill', entity_ref: 'LIIA-EXISTING-BILL', is_settled: true }],
    }));
    const r = await pushConveraCreateBillAndPay(client, [303]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/already settled/);
  });

  it('is_settled guard: skips sub-group when existing bill missing from qb_mirror', async () => {
    const existingBillEvent = { ...singleInvoiceEvent, id: 304, matched_invoice_ids: [501] };
    const { client } = makeMockSupabase(baseTables({
      qb_ingest_events: [existingBillEvent],
      qb_mirror: [],   // no mirror row for LIIA-EXISTING-BILL
    }));
    const r = await pushConveraCreateBillAndPay(client, [304]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/not in qb_mirror/);
  });

  it('skips events with wrong source', async () => {
    const wrong = { ...singleInvoiceEvent, id: 305, source: 'intuit_xlsx' };
    const { client } = makeMockSupabase(baseTables({ qb_ingest_events: [wrong] }));
    const r = await pushConveraCreateBillAndPay(client, [305]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/source='intuit_xlsx'/);
  });
});
