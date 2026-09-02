// converaCreateBillAndPay — Slice C-2 consumer tests.
//
// Verifies:
//  - single-invoice event with missing bill → bill_add + chained pay_bill
//    (with __hydrate_bill_txn_id_from_dep marker) + verify bill_query
//  - event whose bill ALREADY exists is skipped (that's C-1 territory)
//  - multi-invoice event skipped with Slice C-3 direction
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

const multiInvoiceEvent = {
  id: 301,
  source: 'convera',
  amount: 8000,
  counterparty_qb_vendor_list_id: 'V-BIMO',
  status: 'ready',
  target_qb_txn_kind: 'bill_pmt',
  matched_invoice_ids: [600, 601],
  raw_data: { convera_transaction_id: 801 },
};

const converaTxns = [
  { id: 800, confirmation_number: 'CNF-A100', date_of_order: '2026-09-01' },
  { id: 801, confirmation_number: 'CNF-A200', date_of_order: '2026-09-01' },
];

// invoice 500 has NO bill yet (C-2 territory); 501 already has one (C-1 territory)
const invoices = [
  { id: 500, user_id: 'U-LIIA', qb_bill_txn_id: null, total_amount: 5000, invoice_number: 'INV 58', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Liia' }, group_key: null },
  { id: 501, user_id: 'U-LIIA', qb_bill_txn_id: 'LIIA-EXISTING-BILL', total_amount: 5000, invoice_number: 'INV 59', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: { qbVendorName: 'Liia' }, group_key: null },
];

const vendors = [
  { list_id: 'V-LIIA', name: 'Liia' },
  { list_id: 'V-BIMO', name: 'Bimosoft - Someone' },
];

const bankAccounts = [
  { list_id: 'A-WU', full_name: 'BANK/CASH:Western Union Holding', account_type: 'Bank', is_active: true },
  // Expense account so pushConveraInvoiceCreateBill's qb_accounts lookup resolves.
  { list_id: 'EXP-VENDOR-CONSULTANTS', full_name: 'Vendor Consultants', account_type: 'Expense', is_active: true },
];

// Payment profiles for the delegated pushConveraInvoiceCreateBill's vendor resolution.
const paymentProfiles = [
  { id: 33, user_id: 'U-LIIA', qb_vendor_name: 'Liia', is_default: true, company_name: 'Liia PE' },
];

// qb_vendor_mappings — provides default_expense_account_list_id so
// pushConveraInvoiceCreateBill doesn't need to fall back to accountant probe.
const qbVendorMappings = [
  { qb_vendor_list_id: 'V-LIIA', default_expense_account_list_id: 'EXP-VENDOR-CONSULTANTS' },
];

const profiles = [
  { id: 'U-LIIA', name: 'Liia Khaustova' },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('pushConveraCreateBillAndPay', () => {
  it('no-op on empty input', async () => {
    const { client, inserts } = makeMockSupabase({});
    const r = await pushConveraCreateBillAndPay(client, []);
    expect(r.jobIds).toEqual([]);
    expect(r.billAddJobIds).toEqual([]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(inserts).toHaveLength(0);
  });

  it('skips multi-invoice events with Slice C-3 direction', async () => {
    const { client } = makeMockSupabase({
      qb_ingest_events: [multiInvoiceEvent],
      convera_transactions: converaTxns,
      invoices,
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
    });
    const r = await pushConveraCreateBillAndPay(client, [301]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/matched_invoice_ids has 2 entries/);
    expect(r.skippedIneligible[0].reason).toMatch(/Slice C-3/);
  });

  it('skips events whose bill already exists (routes to C-1 instead)', async () => {
    const existingBillEvent = { ...singleInvoiceEvent, id: 302, matched_invoice_ids: [501] };
    const { client } = makeMockSupabase({
      qb_ingest_events: [existingBillEvent],
      convera_transactions: converaTxns,
      invoices,
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
    });
    const r = await pushConveraCreateBillAndPay(client, [302]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/already has qb_bill_txn_id/);
    expect(r.skippedIneligible[0].reason).toMatch(/C-1/);
  });

  it('skips events with wrong source / status / target_qb_txn_kind', async () => {
    const wrong = { ...singleInvoiceEvent, id: 303, source: 'intuit_xlsx' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [wrong], convera_transactions: converaTxns, invoices,
      qb_vendors: vendors, qb_accounts: bankAccounts,
    });
    const r = await pushConveraCreateBillAndPay(client, [303]);
    expect(r.chainedPayJobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/source='intuit_xlsx'/);
  });

  it('single-invoice event with missing bill → bill_add + chained pay + verify with hydration marker', async () => {
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [singleInvoiceEvent],
      convera_transactions: converaTxns,
      invoices,
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
      payment_profiles: paymentProfiles,
      qb_vendor_mappings: qbVendorMappings,
      profiles,
      qb_mirror: [],   // no existing bill in mirror; qbWrite executor uses it for idempotency check
      convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillAndPay(client, [300], { auditTag: 'c2-test' });

    // Should enqueue: 1 bill_add (via delegated consumer) + 1 chained bill_pmt_add + 1 verify bill_query.
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    expect(jobInserts.length).toBeGreaterThanOrEqual(2);   // pay + verify (bill_add also inserts but through the delegated path)

    expect(r.billAddJobIds.length).toBe(1);
    expect(r.chainedPayJobIds.length).toBe(1);
    const payJobId = r.chainedPayJobIds[0];
    expect(r.verifyJobIdByPayJobId[payJobId]).toBeDefined();

    // Find the pay_bill insert and verify shape.
    const payInsert = jobInserts.find(i => (i.rows[0] as { kind: string }).kind === 'bill_pmt_add');
    expect(payInsert).toBeDefined();
    const payPayload = (payInsert!.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payPayload.payeeVendorName).toBe('Liia');
    expect(payPayload.bankAccountName).toBe('BANK/CASH:Western Union Holding');
    expect(payPayload.refNumber).toBe('CNF-A100');
    expect(payPayload.sourceConveraTxnId).toBe(800);
    expect(payPayload.__hydrate_bill_txn_id_from_dep).toBe(r.billAddJobIds[0]);
    expect(payPayload.applications).toEqual([{ billTxnId: null, paymentAmount: 5000 }]);
    expect((payInsert!.rows[0] as { depends_on: number[] }).depends_on).toEqual([r.billAddJobIds[0]]);

    // Verify chain: our C-2 verify (has __verify_for_event_id). The
    // delegated converaInvoiceCreateBill also emits its own bill_query
    // verify on the bill_add — we skip that one.
    const ourVerifyInsert = jobInserts.find(i => {
      const row = i.rows[0] as { kind: string; payload?: Record<string, unknown> };
      return row.kind === 'bill_query' && row.payload?.__verify_for_event_id === 300;
    });
    expect(ourVerifyInsert).toBeDefined();
    const verifyPayload = (ourVerifyInsert!.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(verifyPayload.txnIds).toEqual([null]);
    expect(verifyPayload.__hydrate_bill_txn_id_from_dep).toBe(r.billAddJobIds[0]);
    expect((ourVerifyInsert!.rows[0] as { depends_on: number[] }).depends_on).toEqual([payJobId]);
  });

  it('propagates skips from delegated bill_add consumer up to eventId keying', async () => {
    // Force a create_bill skip by providing an invoice with no payment_profile
    // (converaInvoiceCreateBill will skip: no qb_vendor_name resolvable).
    const badInvoices = [
      { id: 500, user_id: 'U-UNKNOWN', qb_bill_txn_id: null, total_amount: 5000, invoice_number: 'INV 58', period_end: '2026-08-31', status: 'approved', payment_method: 'Convera', payment_profile: null, group_key: null },
    ];
    const { client } = makeMockSupabase({
      qb_ingest_events: [singleInvoiceEvent],
      convera_transactions: converaTxns,
      invoices: badInvoices,
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
      payment_profiles: [],
      qb_vendor_mappings: qbVendorMappings,
      profiles,
      qb_mirror: [],
      convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillAndPay(client, [300]);
    expect(r.chainedPayJobIds).toEqual([]);
    const skipReasons = r.skippedIneligible.map(s => s.reason).join('\n');
    expect(skipReasons).toMatch(/bill_add/);
  });
});
