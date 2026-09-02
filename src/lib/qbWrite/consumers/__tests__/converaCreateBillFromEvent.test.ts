// converaCreateBillFromEvent — Slice C-4 consumer tests.
//
// Verifies:
//  - no-invoice event (matched_invoice_ids=[]) + target=bill_add_and_pmt →
//    bill_add + chained pay_bill + verify (all with WU Holding bank + hydration)
//  - event with matched_invoice_ids populated → skipped (route via
//    pushConveraCreateBillAndPay instead)
//  - wrong source / status / target skipped

import { describe, it, expect } from 'vitest';
import { pushConveraCreateBillFromEvent } from '../converaCreateBillFromEvent';

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
            select() { return Promise.resolve({ data: inserted, error: null }); },
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
  return { client: client as unknown as Parameters<typeof pushConveraCreateBillFromEvent>[0], inserts };
}

const bhavaniEvent = {
  id: 400,
  source: 'convera',
  txn_date: '2026-08-31',
  amount: 4393,
  counterparty_raw: 'BHAVANI ENUGALA',
  memo: 'Inv# July\'26',
  counterparty_qb_vendor_list_id: 'V-BHAVANI',
  qb_bank_account_list_id: null,
  qb_expense_account_list_id: 'EXP-VENDOR-CONSULTANTS',
  target_qb_txn_kind: 'bill_add_and_pmt',
  status: 'ready',
  matched_invoice_ids: [],
  raw_data: { convera_transaction_id: 990, confirmation_number: 'OTR9999999' },
};

const vendors = [{ list_id: 'V-BHAVANI', name: 'Bhavani Enugala' }];
const bankAccounts = [
  { list_id: 'A-WU', full_name: 'BANK/CASH:Western Union Holding', account_type: 'Bank', is_active: true },
];
const expenseAccounts = [
  { list_id: 'EXP-VENDOR-CONSULTANTS', full_name: 'Vendor Consultants' },
];

describe('pushConveraCreateBillFromEvent', () => {
  it('no-op on empty input', async () => {
    const { client, inserts } = makeMockSupabase({});
    const r = await pushConveraCreateBillFromEvent(client, []);
    expect(r.jobIds).toEqual([]);
    expect(inserts).toHaveLength(0);
  });

  it('no-invoice Bhavani event → bill_add + chained pay_bill + verify against WU Holding bank', async () => {
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [bhavaniEvent],
      qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: [],
      convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [400], { auditTag: 'c4-test' });
    expect(r.skippedIneligible).toEqual([]);
    expect(r.jobIds).toHaveLength(1);              // bill_add
    const billAddJobId = r.jobIds[0]!;
    expect(r.chainedPayJobIdByBillAddJobId[billAddJobId]).toBeDefined();
    const payJobId = r.chainedPayJobIdByBillAddJobId[billAddJobId];
    expect(r.chainedVerifyJobIdByPayJobId[payJobId]).toBeDefined();

    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    // Expect at least 3 inserts: bill_add (via executor), bill_pmt_add chain, bill_query verify
    expect(jobInserts.length).toBeGreaterThanOrEqual(3);
    const payInsert = jobInserts.find(i => (i.rows[0] as { kind: string }).kind === 'bill_pmt_add');
    expect(payInsert).toBeDefined();
    const payload = (payInsert!.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.payeeVendorName).toBe('Bhavani Enugala');
    expect(payload.bankAccountName).toBe('BANK/CASH:Western Union Holding');
    expect(payload.refNumber).toBe('OTR9999999');
    expect(payload.applications).toEqual([{ billTxnId: null, paymentAmount: 4393 }]);
    expect(payload.__hydrate_bill_txn_id_from_dep).toBe(billAddJobId);
    expect(payload.sourceIngestEventId).toBe(400);
  });

  it('skips events with matched_invoice_ids populated (route via pushConveraCreateBillAndPay)', async () => {
    const withInvoice = { ...bhavaniEvent, id: 401, matched_invoice_ids: [500] };
    const { client } = makeMockSupabase({
      qb_ingest_events: [withInvoice],
      qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: [],
      convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [401]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/matched_invoice_ids populated/);
  });

  it('skips events with wrong source', async () => {
    const wrong = { ...bhavaniEvent, id: 402, source: 'intuit_xlsx' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [wrong], qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: [], convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [402]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/source='intuit_xlsx'/);
  });

  it('skips events with target that is neither bill_add_and_pmt nor bill_pmt', async () => {
    const wrong = { ...bhavaniEvent, id: 403, target_qb_txn_kind: 'check' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [wrong], qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: [], convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [403]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/handles bill_add_and_pmt \(Case C\) or bill_pmt \(Case D\)/);
  });

  it('Case C requires expense account: skips with actionable reason when none set + no open bill', async () => {
    const noExp = { ...bhavaniEvent, id: 404, qb_expense_account_list_id: null };
    const { client } = makeMockSupabase({
      qb_ingest_events: [noExp], qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: [], convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [404]);
    expect(r.jobIds).toEqual([]);
    // Now: gate 2 finds no open bill → falls to Case C → expense account required.
    expect(r.skippedIneligible[0].reason).toMatch(/no open bill in QB.*Case C.*qb_expense_account_list_id/);
  });

  it('Case D: single open bill for vendor in qb_mirror → direct pay (no create chain)', async () => {
    // target=bill_pmt widget hint, but consumer's real decision is qb_mirror lookup.
    const caseDEvent = { ...bhavaniEvent, id: 410, target_qb_txn_kind: 'bill_pmt', amount: 4393 };
    const openBill = { entity_kind: 'bill', entity_ref: 'BHAVANI-EXISTING-BILL', vendor_list_id: 'V-BHAVANI', amount: 4393, is_settled: false, data: { vendor_name: 'Bhavani Enugala' } };
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [caseDEvent], qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: [openBill], convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [410]);
    expect(r.skippedIneligible).toEqual([]);
    // Case D direct pay: no create chain, just a pay_bill against the existing TxnID.
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    const payInsert = jobInserts.find(i => (i.rows[0] as { kind: string }).kind === 'bill_pmt_add');
    expect(payInsert).toBeDefined();
    const payload = (payInsert!.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.applications).toEqual([{ billTxnId: 'BHAVANI-EXISTING-BILL', paymentAmount: 4393 }]);
    expect(payload.sourceConveraTxnId).toBe(990);
    // No create_bill emitted for this event.
    const billAddInserts = jobInserts.filter(i => (i.rows[0] as { kind: string }).kind === 'bill_add');
    expect(billAddInserts).toHaveLength(0);
  });

  it('Case D: multiple open bills, one amount-matches wire → pays the amount-matched bill', async () => {
    const caseDEvent = { ...bhavaniEvent, id: 411, target_qb_txn_kind: 'bill_pmt', amount: 4393 };
    const openBills = [
      { entity_kind: 'bill', entity_ref: 'BILL-A', vendor_list_id: 'V-BHAVANI', amount: 4393, is_settled: false, data: { vendor_name: 'Bhavani Enugala' } },
      { entity_kind: 'bill', entity_ref: 'BILL-B', vendor_list_id: 'V-BHAVANI', amount: 9999, is_settled: false, data: { vendor_name: 'Bhavani Enugala' } },
    ];
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [caseDEvent], qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: openBills, convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [411]);
    expect(r.skippedIneligible).toEqual([]);
    const payInsert = inserts.filter(i => i.table === 'qb_sync_jobs').find(i => (i.rows[0] as { kind: string }).kind === 'bill_pmt_add')!;
    const payload = (payInsert.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.applications).toEqual([{ billTxnId: 'BILL-A', paymentAmount: 4393 }]);
  });

  it('Case D ambiguous: multiple open bills + no amount match → skip with disambiguation reason', async () => {
    const caseDEvent = { ...bhavaniEvent, id: 412, target_qb_txn_kind: 'bill_pmt', amount: 4393 };
    const openBills = [
      { entity_kind: 'bill', entity_ref: 'BILL-X', vendor_list_id: 'V-BHAVANI', amount: 1000, is_settled: false, data: {} },
      { entity_kind: 'bill', entity_ref: 'BILL-Y', vendor_list_id: 'V-BHAVANI', amount: 2000, is_settled: false, data: {} },
    ];
    const { client } = makeMockSupabase({
      qb_ingest_events: [caseDEvent], qb_vendors: vendors,
      qb_accounts: [...bankAccounts, ...expenseAccounts],
      qb_mirror: openBills, convera_transaction_billpmts: [],
    });
    const r = await pushConveraCreateBillFromEvent(client, [412]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/2 open bills.*none amount-matches/);
  });
});
