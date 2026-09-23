import { describe, it, expect } from 'vitest';
import { computeMissingPpMappings } from '../ppMappingReconciler';

const BANK = '800000F5-1529957073';
const EXPENSE = '600000-1142369998';

describe('computeMissingPpMappings', () => {
  it('empty inputs → no inserts', () => {
    expect(computeMissingPpMappings({ paymentProfiles: [], mappings: [], vendors: [] })).toEqual([]);
  });

  it('picks up a pp with qb_vendor_name matching a known vendor and no existing mapping', () => {
    const inserts = computeMissingPpMappings({
      paymentProfiles: [{ id: 102, qbVendorName: 'Teal Crossroads', companyName: 'Teal LLC' }],
      mappings: [],
      vendors: [{ listId: 'V-TEAL', name: 'Teal Crossroads' }],
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      pp_id: 102,
      qb_vendor_list_id: 'V-TEAL',
      counterparty_pattern: 'Teal LLC',
      source: 'convera',
      default_target_kind: 'bill_pmt',
      default_bank_account_list_id: BANK,
      default_expense_account_list_id: EXPENSE,
    });
  });

  it('skips pps that already have a mapping row', () => {
    const inserts = computeMissingPpMappings({
      paymentProfiles: [{ id: 102, qbVendorName: 'Teal Crossroads', companyName: 'Teal LLC' }],
      mappings: [{ ppId: 102 }],
      vendors: [{ listId: 'V-TEAL', name: 'Teal Crossroads' }],
    });
    expect(inserts).toEqual([]);
  });

  it('skips pps whose qb_vendor_name is null/empty/whitespace', () => {
    const inserts = computeMissingPpMappings({
      paymentProfiles: [
        { id: 1, qbVendorName: null, companyName: 'A' },
        { id: 2, qbVendorName: '', companyName: 'B' },
        { id: 3, qbVendorName: '   ', companyName: 'C' },
      ],
      mappings: [],
      vendors: [{ listId: 'V-X', name: 'X' }],
    });
    expect(inserts).toEqual([]);
  });

  it('skips pps whose qb_vendor_name does not resolve to any vendor', () => {
    const inserts = computeMissingPpMappings({
      paymentProfiles: [{ id: 102, qbVendorName: 'Nonexistent Vendor', companyName: 'X' }],
      mappings: [],
      vendors: [{ listId: 'V-TEAL', name: 'Teal Crossroads' }],
    });
    expect(inserts).toEqual([]);
  });

  it('matches case-insensitively with trimming (Bimosoft naming pattern)', () => {
    const inserts = computeMissingPpMappings({
      paymentProfiles: [{ id: 33, qbVendorName: '  BIMOSOFT - Fadil Kalaca  ', companyName: 'Bimosoft' }],
      mappings: [],
      vendors: [{ listId: 'V-BIMO-FADIL', name: 'Bimosoft - Fadil Kalaca' }],
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].qb_vendor_list_id).toBe('V-BIMO-FADIL');
  });

  it('handles the observed prod case (9 approved-invisible pps)', () => {
    const inserts = computeMissingPpMappings({
      paymentProfiles: [
        { id: 108, qbVendorName: 'Usluznicki obrt 2H', companyName: 'Usluznicki' },  // Harun
        { id: 33, qbVendorName: 'Bimosoft - Fadil Kalaca', companyName: 'Bimosoft' },
        { id: 107, qbVendorName: 'NEBULA STUDIO', companyName: 'Nebula' },           // Edo
        { id: 60, qbVendorName: 'Bimosoft - Naretena Arnaut', companyName: 'Bimosoft' },
      ],
      mappings: [],
      vendors: [
        { listId: 'V-2H', name: 'Usluznicki obrt 2H' },
        { listId: 'V-BIMO-FADIL', name: 'Bimosoft - Fadil Kalaca' },
        { listId: 'V-NEBULA', name: 'NEBULA STUDIO' },
        { listId: 'V-BIMO-NARETENA', name: 'Bimosoft - Naretena Arnaut' },
      ],
    });
    expect(inserts).toHaveLength(4);
    const byPp = new Map(inserts.map(i => [i.pp_id, i.qb_vendor_list_id]));
    expect(byPp.get(108)).toBe('V-2H');
    expect(byPp.get(33)).toBe('V-BIMO-FADIL');
    expect(byPp.get(107)).toBe('V-NEBULA');
    expect(byPp.get(60)).toBe('V-BIMO-NARETENA');
  });

  it('handles null companyName as empty counterparty_pattern (defensive)', () => {
    const inserts = computeMissingPpMappings({
      paymentProfiles: [{ id: 1, qbVendorName: 'X', companyName: null }],
      mappings: [],
      vendors: [{ listId: 'V-X', name: 'X' }],
    });
    expect(inserts[0]?.counterparty_pattern).toBe('');
  });
});
