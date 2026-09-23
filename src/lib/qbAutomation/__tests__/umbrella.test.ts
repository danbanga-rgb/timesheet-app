import { describe, it, expect } from 'vitest';
import { isUmbrellaEvent, getEffectiveMatchedInvoiceIds } from '../umbrella';

describe('isUmbrellaEvent', () => {
  it('returns false for single-invoice events', () => {
    const inv = new Map([[1, { userId: 'u1' }]]);
    expect(isUmbrellaEvent({ id: 100, matchedInvoiceIds: [1] }, inv)).toBe(false);
  });

  it('returns false for zero-invoice events', () => {
    const inv = new Map<number, { userId: string | null }>();
    expect(isUmbrellaEvent({ id: 100, matchedInvoiceIds: [] }, inv)).toBe(false);
  });

  it('returns false when multiple invoices all share one contractor', () => {
    const inv = new Map([
      [1, { userId: 'u1' }],
      [2, { userId: 'u1' }],
      [3, { userId: 'u1' }],
    ]);
    expect(isUmbrellaEvent({ id: 100, matchedInvoiceIds: [1, 2, 3] }, inv)).toBe(false);
  });

  it('returns true for Teal wire (8 contractors)', () => {
    const inv = new Map<number, { userId: string | null }>();
    for (let i = 1; i <= 8; i++) inv.set(i, { userId: `u${i}` });
    expect(isUmbrellaEvent({ id: 100, matchedInvoiceIds: [1, 2, 3, 4, 5, 6, 7, 8] }, inv)).toBe(true);
  });

  it('returns true for Faruk-covers-Ajdin (2 contractors, whether or not Ajdin has own pp)', () => {
    const inv = new Map([
      [10, { userId: 'faruk' }],
      [11, { userId: 'ajdin' }],
    ]);
    expect(isUmbrellaEvent({ id: 100, matchedInvoiceIds: [10, 11] }, inv)).toBe(true);
  });

  it('ignores invoices missing from the map (defensive)', () => {
    const inv = new Map([[1, { userId: 'u1' }]]);
    expect(isUmbrellaEvent({ id: 100, matchedInvoiceIds: [1, 999] }, inv)).toBe(false);
  });

  it('ignores invoices whose userId is null (would-be second contractor filtered out)', () => {
    const inv = new Map<number, { userId: string | null }>([
      [1, { userId: 'u1' }],
      [2, { userId: null }],
    ]);
    expect(isUmbrellaEvent({ id: 100, matchedInvoiceIds: [1, 2] }, inv)).toBe(false);
  });

  it('returns true when matched_invoice_ids has 1 but umbrellaShares reveals more (Teal event 451 case)', () => {
    const inv = new Map([
      [227, { userId: 'strahinja' }],
      [222, { userId: 'dusan' }],
      [223, { userId: 'iskra' }],
      [224, { userId: 'damjan' }],
      [225, { userId: 'petar' }],
      [226, { userId: 'senad' }],
    ]);
    const shares = new Map([
      ['451::227', 8100],
      ['451::222', 6160],
      ['451::223', 3520],
      ['451::224', 7200],
      ['451::225', 4320],
      ['451::226', 8100],
    ]);
    expect(isUmbrellaEvent({ id: 451, matchedInvoiceIds: [227] }, inv, shares)).toBe(true);
  });

  it('shares from a different event ID do not leak into detection', () => {
    const inv = new Map([[227, { userId: 'strahinja' }]]);
    const shares = new Map([['999::222', 6160]]);
    expect(isUmbrellaEvent({ id: 451, matchedInvoiceIds: [227] }, inv, shares)).toBe(false);
  });
});

describe('getEffectiveMatchedInvoiceIds', () => {
  it('returns only matched_invoice_ids when umbrellaShares is absent', () => {
    expect(getEffectiveMatchedInvoiceIds({ id: 100, matchedInvoiceIds: [1, 2] })).toEqual([1, 2]);
  });

  it('unions matched_invoice_ids with umbrella-share invoice IDs for the same event', () => {
    const shares = new Map([['100::5', 500], ['100::6', 600]]);
    const ids = getEffectiveMatchedInvoiceIds({ id: 100, matchedInvoiceIds: [1] }, shares);
    expect(ids.sort()).toEqual([1, 5, 6]);
  });

  it('dedupes when the same invoice appears in both sources', () => {
    const shares = new Map([['100::1', 100], ['100::2', 200]]);
    const ids = getEffectiveMatchedInvoiceIds({ id: 100, matchedInvoiceIds: [1, 2] }, shares);
    expect(ids.sort()).toEqual([1, 2]);
  });

  it('ignores shares for other events', () => {
    const shares = new Map([['999::7', 700]]);
    const ids = getEffectiveMatchedInvoiceIds({ id: 100, matchedInvoiceIds: [1] }, shares);
    expect(ids).toEqual([1]);
  });
});

// buildUmbrellaVendorSet + isUmbrellaVendor were removed in V9.8. Pre-wire
// umbrella surfaces via (qbVendorListId, monthKey) grouping in the hook —
// no separate "is this vendor umbrella" check needed.
