// converaBillPmt — Slice C-1 consumer tests.
//
// Verifies:
//  - eligible Convera events with all bills present → executor enqueues one
//    pay_bill per event (umbrella = one BillPmt with N applications)
//  - missing bill on any matched invoice → skipped with C-2 direction
//  - wrong source / status / target_qb_txn_kind → skipped
//  - amount-mismatch between wire and sum(applications) → skipped
//  - verify chain (bill_query with depends_on) chained per successful pay_bill

import { describe, it, expect } from 'vitest';
import { pushConveraBillPmt } from '../converaBillPmt';

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
          return {
            select() {
              const data = newRows.map(() => ({ id: nextId++ }));
              return Promise.resolve({ data, error: null });
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
  return { client: client as unknown as Parameters<typeof pushConveraBillPmt>[0], inserts };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const readyEvent = {
  id: 42,
  source: 'convera',
  amount: 3520,
  counterparty_qb_vendor_list_id: 'V-FATSTRUCT',
  status: 'ready',
  target_qb_txn_kind: 'bill_pmt',
  matched_invoice_ids: [250],
  raw_data: { convera_transaction_id: 700 },
};

const readyUmbrellaEvent = {
  id: 43,
  source: 'convera',
  amount: 8000,       // sum of umbrella shares
  counterparty_qb_vendor_list_id: 'V-TCODE',
  status: 'ready',
  target_qb_txn_kind: 'bill_pmt',
  matched_invoice_ids: [260, 261],
  raw_data: { convera_transaction_id: 701 },
};

const converaTxns = [
  { id: 700, confirmation_number: 'OTR6649769', date_of_order: '2026-09-01' },
  { id: 701, confirmation_number: 'OTR7000123', date_of_order: '2026-09-01' },
];

const invoices = [
  { id: 250, qb_bill_txn_id: 'FS-BILL-A', total_amount: 3520, invoice_number: 'INV 1-1-1' },
  { id: 260, qb_bill_txn_id: 'TC-BILL-A', total_amount: 4000, invoice_number: 'INV 12-1' },
  { id: 261, qb_bill_txn_id: 'TC-BILL-B', total_amount: 4000, invoice_number: 'INV 12-2' },
];

// Umbrella allocation for wire 701 splitting 8000 evenly across two invoices.
const umbrellaLinks = [
  { transaction_id: 701, invoice_id: 260, amount_share: 4000 },
  { transaction_id: 701, invoice_id: 261, amount_share: 4000 },
];

const vendors = [
  { list_id: 'V-FATSTRUCT', name: 'Fat Struct - Tomislav' },
  { list_id: 'V-TCODE', name: 'TCODE - Branimir' },
];

const bankAccounts = [
  { list_id: 'A-WU', full_name: 'BANK/CASH:Western Union Holding', account_type: 'Bank', is_active: true },
  { list_id: 'A-8220', full_name: 'BANK/CASH:8220 - Key Point Checking', account_type: 'Bank', is_active: true },
];

// qb_mirror rows for the executor's INVARIANTS #11 cross-check (bill TxnID
// must belong to the intent's payeeVendorName). Also #18/#19 skip-if-posted.
const qbMirror = [
  { entity_kind: 'bill', entity_ref: 'FS-BILL-A', vendor_list_id: 'V-FATSTRUCT',
    amount: 3520, is_settled: false, data: { vendor_name: 'Fat Struct - Tomislav' } },
  { entity_kind: 'bill', entity_ref: 'TC-BILL-A', vendor_list_id: 'V-TCODE',
    amount: 4000, is_settled: false, data: { vendor_name: 'TCODE - Branimir' } },
  { entity_kind: 'bill', entity_ref: 'TC-BILL-B', vendor_list_id: 'V-TCODE',
    amount: 4000, is_settled: false, data: { vendor_name: 'TCODE - Branimir' } },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('pushConveraBillPmt', () => {
  it('no-op on empty input', async () => {
    const { client, inserts } = makeMockSupabase({});
    const r = await pushConveraBillPmt(client, []);
    expect(r).toEqual({
      jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible: [], verifyJobIdByPayJobId: {},
    });
    expect(inserts).toHaveLength(0);
  });

  it('single-match wire → one pay_bill with one application; verify chain queued', async () => {
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [readyEvent],
      convera_transactions: converaTxns,
      invoices,
      convera_transaction_invoices: umbrellaLinks,
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
      qb_mirror: qbMirror,
    });
    const r = await pushConveraBillPmt(client, [42], { auditTag: 'convera-test' });
    expect(r.rejected).toEqual([]);
    expect(r.skippedDuplicate).toEqual([]);
    expect(r.skippedIneligible).toEqual([]);
    expect(r.jobIds).toEqual([9000]);
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    expect(jobInserts).toHaveLength(2);   // pay_bill + verify bill_query
    const payJob = jobInserts[0].rows[0] as Record<string, unknown>;
    expect(payJob.kind).toBe('bill_pmt_add');
    const payload = payJob.payload as Record<string, unknown>;
    expect(payload.payeeVendorName).toBe('Fat Struct - Tomislav');
    expect(payload.bankAccountName).toBe('BANK/CASH:Western Union Holding');
    expect(payload.refNumber).toBe('OTR6649769');
    expect(payload.sourceConveraTxnId).toBe(700);
    expect(payload.applications).toEqual([{ billTxnId: 'FS-BILL-A', paymentAmount: 3520 }]);
    const verify = jobInserts[1].rows[0] as Record<string, unknown>;
    expect(verify.kind).toBe('bill_query');
    expect(verify.depends_on).toEqual([9000]);
    const vPayload = verify.payload as Record<string, unknown>;
    expect(vPayload.txnIds).toEqual(['FS-BILL-A']);
    expect(vPayload.__verify_for_event_id).toBe(42);
  });

  it('umbrella wire → one pay_bill with N applications, verify chain covers all bills', async () => {
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [readyUmbrellaEvent],
      convera_transactions: converaTxns,
      invoices,
      convera_transaction_invoices: umbrellaLinks,
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
      qb_mirror: qbMirror,
    });
    const r = await pushConveraBillPmt(client, [43]);
    expect(r.skippedIneligible).toEqual([]);
    expect(r.jobIds).toEqual([9000]);
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    const payload = (jobInserts[0].rows[0] as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload.applications).toEqual([
      { billTxnId: 'TC-BILL-A', paymentAmount: 4000 },
      { billTxnId: 'TC-BILL-B', paymentAmount: 4000 },
    ]);
    const vPayload = (jobInserts[1].rows[0] as Record<string, unknown>).payload as Record<string, unknown>;
    expect(vPayload.txnIds).toEqual(['TC-BILL-A', 'TC-BILL-B']);
  });

  it('skips event when any matched invoice lacks qb_bill_txn_id (points at Slice C-2)', async () => {
    const invsWithHole = [
      { id: 250, qb_bill_txn_id: null, total_amount: 3520, invoice_number: 'INV 1-1-1' },
    ];
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [readyEvent],
      convera_transactions: converaTxns,
      invoices: invsWithHole,
      convera_transaction_invoices: [],
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
      qb_mirror: qbMirror,
    });
    const r = await pushConveraBillPmt(client, [42]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible).toHaveLength(1);
    expect(r.skippedIneligible[0].eventId).toBe(42);
    expect(r.skippedIneligible[0].reason).toMatch(/Missing bills for invoice ids \[250\]/);
    expect(r.skippedIneligible[0].reason).toMatch(/C-2 will automate/);
    expect(inserts.filter(i => i.table === 'qb_sync_jobs')).toHaveLength(0);
  });

  it('skips events with wrong source', async () => {
    const intuit = { ...readyEvent, id: 44, source: 'intuit_xlsx' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [intuit],
      convera_transactions: converaTxns, invoices, convera_transaction_invoices: umbrellaLinks,
      qb_vendors: vendors, qb_accounts: bankAccounts,
    });
    const r = await pushConveraBillPmt(client, [44]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/source='intuit_xlsx'/);
  });

  it('skips events with wrong target_qb_txn_kind (bill_add_and_pmt is C-2)', async () => {
    const wrong = { ...readyEvent, id: 45, target_qb_txn_kind: 'bill_add_and_pmt' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [wrong], convera_transactions: converaTxns, invoices,
      convera_transaction_invoices: [], qb_vendors: vendors, qb_accounts: bankAccounts,
    });
    const r = await pushConveraBillPmt(client, [45]);
    expect(r.skippedIneligible[0].reason).toMatch(/C-1 handles bill_pmt only/);
  });

  it('skips already-posted events', async () => {
    const posted = { ...readyEvent, id: 46, status: 'posted' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [posted], convera_transactions: converaTxns, invoices,
      convera_transaction_invoices: [], qb_vendors: vendors, qb_accounts: bankAccounts,
    });
    const r = await pushConveraBillPmt(client, [46]);
    expect(r.skippedIneligible[0].reason).toMatch(/already pushed/);
  });

  it('skips events where sum(applications) ≠ wire amount (umbrella allocation drift)', async () => {
    // event.amount = 8000 but umbrella shares only add up to 7500 → skip
    const skewedLinks = [
      { transaction_id: 701, invoice_id: 260, amount_share: 4000 },
      { transaction_id: 701, invoice_id: 261, amount_share: 3500 },
    ];
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyUmbrellaEvent],
      convera_transactions: converaTxns,
      invoices,
      convera_transaction_invoices: skewedLinks,
      qb_vendors: vendors,
      qb_accounts: bankAccounts,
      qb_mirror: qbMirror,
    });
    const r = await pushConveraBillPmt(client, [43]);
    expect(r.skippedIneligible[0].reason).toMatch(/amount-mismatch/);
  });

  it('skips events when the WU Holding bank account is missing', async () => {
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent],
      convera_transactions: converaTxns,
      invoices,
      convera_transaction_invoices: umbrellaLinks,
      qb_vendors: vendors,
      qb_accounts: [{ list_id: 'A-8220', full_name: 'BANK/CASH:8220 - Key Point Checking', account_type: 'Bank', is_active: true }],
    });
    const r = await pushConveraBillPmt(client, [42]);
    expect(r.skippedIneligible[0].reason).toMatch(/western union holding/i);
  });
});
