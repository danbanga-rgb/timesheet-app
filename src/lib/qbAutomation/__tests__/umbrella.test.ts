import { describe, it, expect } from 'vitest';
import { isUmbrellaEvent, isUmbrellaVendor, buildUmbrellaVendorSet } from '../umbrella';

describe('isUmbrellaEvent', () => {
  it('returns false for single-invoice events', () => {
    const inv = new Map([[1, { userId: 'u1' }]]);
    expect(isUmbrellaEvent({ matchedInvoiceIds: [1] }, inv)).toBe(false);
  });

  it('returns false for zero-invoice events', () => {
    const inv = new Map<number, { userId: string | null }>();
    expect(isUmbrellaEvent({ matchedInvoiceIds: [] }, inv)).toBe(false);
  });

  it('returns false when multiple invoices all share one contractor', () => {
    const inv = new Map([
      [1, { userId: 'u1' }],
      [2, { userId: 'u1' }],
      [3, { userId: 'u1' }],
    ]);
    expect(isUmbrellaEvent({ matchedInvoiceIds: [1, 2, 3] }, inv)).toBe(false);
  });

  it('returns true for Teal wire (8 contractors)', () => {
    const inv = new Map<number, { userId: string | null }>();
    for (let i = 1; i <= 8; i++) inv.set(i, { userId: `u${i}` });
    expect(isUmbrellaEvent({ matchedInvoiceIds: [1, 2, 3, 4, 5, 6, 7, 8] }, inv)).toBe(true);
  });

  it('returns true for Faruk-covers-Ajdin (2 contractors, whether or not Ajdin has own pp)', () => {
    const inv = new Map([
      [10, { userId: 'faruk' }],
      [11, { userId: 'ajdin' }],
    ]);
    expect(isUmbrellaEvent({ matchedInvoiceIds: [10, 11] }, inv)).toBe(true);
  });

  it('ignores invoices missing from the map (defensive)', () => {
    const inv = new Map([[1, { userId: 'u1' }]]);
    expect(isUmbrellaEvent({ matchedInvoiceIds: [1, 999] }, inv)).toBe(false);
  });

  it('ignores invoices whose userId is null (would-be second contractor filtered out)', () => {
    const inv = new Map<number, { userId: string | null }>([
      [1, { userId: 'u1' }],
      [2, { userId: null }],
    ]);
    expect(isUmbrellaEvent({ matchedInvoiceIds: [1, 2] }, inv)).toBe(false);
  });
});

describe('buildUmbrellaVendorSet', () => {
  it('empty mappings → empty set', () => {
    expect(buildUmbrellaVendorSet([]).size).toBe(0);
  });

  it('flags Teal (1 vendor, 8 pps)', () => {
    const mappings = [];
    for (let pp = 1; pp <= 8; pp++) {
      mappings.push({ qbVendorListId: 'V-TEAL', ppId: pp });
    }
    const set = buildUmbrellaVendorSet(mappings);
    expect(set.has('V-TEAL')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('does NOT flag Bimosoft per-contractor vendors (each vendor mapped by 1 pp)', () => {
    const mappings = [
      { qbVendorListId: 'V-BIMO-FARUK', ppId: 100 },
      { qbVendorListId: 'V-BIMO-EDIN', ppId: 101 },
      { qbVendorListId: 'V-BIMO-NARETENA', ppId: 102 },
    ];
    expect(buildUmbrellaVendorSet(mappings).size).toBe(0);
  });

  it('flags Faruk vendor when Ajdin has separate pp mapped there', () => {
    const mappings = [
      { qbVendorListId: 'V-FARUK', ppId: 200 },  // Faruk's own pp
      { qbVendorListId: 'V-FARUK', ppId: 201 },  // Ajdin's pp routed here
    ];
    expect(buildUmbrellaVendorSet(mappings).has('V-FARUK')).toBe(true);
  });

  it('ignores mappings with null ppId (legacy pattern-only rows)', () => {
    const mappings = [
      { qbVendorListId: 'V-LEGACY', ppId: null },
      { qbVendorListId: 'V-LEGACY', ppId: null },
      { qbVendorListId: 'V-LEGACY', ppId: null },
    ];
    // Three null-pp rows are legacy noise, not umbrella evidence.
    expect(buildUmbrellaVendorSet(mappings).size).toBe(0);
  });

  it('handles mixed Teal + Bimosoft in one call', () => {
    const mappings = [
      { qbVendorListId: 'V-TEAL', ppId: 1 },
      { qbVendorListId: 'V-TEAL', ppId: 2 },
      { qbVendorListId: 'V-BIMO-A', ppId: 10 },
      { qbVendorListId: 'V-BIMO-B', ppId: 11 },
    ];
    const set = buildUmbrellaVendorSet(mappings);
    expect(set.has('V-TEAL')).toBe(true);
    expect(set.has('V-BIMO-A')).toBe(false);
    expect(set.has('V-BIMO-B')).toBe(false);
  });
});

describe('isUmbrellaVendor', () => {
  const set = new Set(['V-TEAL', 'V-FARUK']);

  it('true for a vendor in the umbrella set', () => {
    expect(isUmbrellaVendor('V-TEAL', set)).toBe(true);
  });

  it('false for a vendor not in the set', () => {
    expect(isUmbrellaVendor('V-BIMO-A', set)).toBe(false);
  });

  it('false for null vendor listId', () => {
    expect(isUmbrellaVendor(null, set)).toBe(false);
  });
});
