// intuitInvoiceCreateBill — mirror idempotency (2026-09-25).
// QB may already hold a bill for (vendor, RefNumber) that WE didn't book
// (accountant entered it by hand, or a contractor reused an invoice number).
// Parity with converaInvoiceCreateBill Layer 3.

import { describe, it, expect } from 'vitest';
import { pushIntuitInvoiceCreateBill } from '../intuitInvoiceCreateBill';

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
  return { client: client as unknown as Parameters<typeof pushIntuitInvoiceCreateBill>[0], inserts };
}


const VENDOR = { list_id: 'V-YARA', name: 'Yara Solutions Inc' };
const baseTables = (mirror: Row[]) => ({
  invoices: [{
    id: 312, user_id: 'u-ravi', invoice_number: 'INV 13', total_amount: '11760.00', period_end: '2026-08-31',
    status: 'approved', payment_method: 'Intuit', qb_bill_txn_id: null,
    payment_profile: { id: 77, qbVendorName: 'Yara Solutions Inc' }, matcher_ignore: false,
  }],
  payment_profiles: [{ id: 77, user_id: 'u-ravi', qb_vendor_name: 'Yara Solutions Inc', is_default: true, company_name: 'Yara Solutions Inc' }],
  qb_vendors: [VENDOR],
  qb_vendor_mappings: [{ qb_vendor_list_id: 'V-YARA', default_expense_account_list_id: 'A-VC' }],
  profiles: [{ id: 'u-ravi', name: 'Ravi Prasad Reddy' }],
  qb_accounts: [{ list_id: 'A-VC', full_name: 'Vendor Consultants' }],
  qb_mirror: mirror,
});

describe('pushIntuitInvoiceCreateBill — mirror idempotency', () => {
  it('skips when qb_mirror already has a bill for the same vendor + RefNumber', async () => {
    const { client, inserts } = makeMockSupabase(baseTables([
      { entity_kind: 'bill', vendor_list_id: 'V-YARA', ref_number: 'INV 13' },
    ]));
    const r = await pushIntuitInvoiceCreateBill(client, [312], { auditTag: 't' });
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible.map(s => s.reason).join(' ')).toMatch(/already has a bill.*INV 13/);
    expect(inserts.filter(i => i.table === 'qb_sync_jobs')).toHaveLength(0);
  });

  it('does not skip for a bill with the same RefNumber under a different vendor', async () => {
    const { client } = makeMockSupabase(baseTables([
      { entity_kind: 'bill', vendor_list_id: 'V-OTHER', ref_number: 'INV 13' },
    ]));
    const r = await pushIntuitInvoiceCreateBill(client, [312], { auditTag: 't' });
    expect(r.skippedIneligible.map(s => s.reason).join(' ')).not.toMatch(/already has a bill/);
  });
});
