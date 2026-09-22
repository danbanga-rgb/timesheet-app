import { describe, it, expect } from 'vitest';
import { detectDiscrepancies, type DiscrepancyContext, type RateHistoryEntry } from '../discrepancies';

function ctx(overrides: Partial<DiscrepancyContext> = {}): DiscrepancyContext {
  return {
    rateHistory: [],
    vendorContractors: new Map(),
    openBills: [],
    ...overrides,
  };
}

describe('detectDiscrepancies — rate drift', () => {
  const rateHistory: RateHistoryEntry[] = [
    { userId: 'user-a', rateKind: 'pay', rate: 40, effectiveFrom: '2026-01-01', effectiveTo: null },
  ];

  it('flags rate drift when invoice rate differs from current pay rate', () => {
    const d = detectDiscrepancies(
      {
        invoiceRate: 35,
        invoicePeriodEnd: '2026-06-30',
        invoiceUserId: 'user-a',
        vendorListId: null,
        vendorName: 'X',
        refNumber: '',
        monthKey: '',
      },
      ctx({ rateHistory }),
    );
    expect(d.length).toBe(1);
    expect(d[0].kind).toBe('rate_drift');
    expect(d[0].message).toMatch(/\$35.*\$40/);
  });

  it('does not flag when rate matches', () => {
    const d = detectDiscrepancies(
      {
        invoiceRate: 40,
        invoicePeriodEnd: '2026-06-30',
        invoiceUserId: 'user-a',
        vendorListId: null,
        vendorName: 'X',
        refNumber: '',
        monthKey: '',
      },
      ctx({ rateHistory }),
    );
    expect(d.length).toBe(0);
  });

  it('picks the correct row when rate history has multiple effective_from windows', () => {
    const history: RateHistoryEntry[] = [
      { userId: 'user-a', rateKind: 'pay', rate: 30, effectiveFrom: '2026-01-01', effectiveTo: '2026-04-01' },
      { userId: 'user-a', rateKind: 'pay', rate: 40, effectiveFrom: '2026-04-01', effectiveTo: null },
    ];
    // Invoice period ends 2026-06-30 → should use the $40 row.
    const d = detectDiscrepancies(
      {
        invoiceRate: 30,
        invoicePeriodEnd: '2026-06-30',
        invoiceUserId: 'user-a',
        vendorListId: null,
        vendorName: 'X',
        refNumber: '',
        monthKey: '',
      },
      ctx({ rateHistory: history }),
    );
    expect(d[0].message).toMatch(/\$30.*\$40/);
  });

  it('ignores bill_kind rate rows', () => {
    const history: RateHistoryEntry[] = [
      { userId: 'user-a', rateKind: 'bill', rate: 80, effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const d = detectDiscrepancies(
      {
        invoiceRate: 35,
        invoicePeriodEnd: '2026-06-30',
        invoiceUserId: 'user-a',
        vendorListId: null,
        vendorName: 'X',
        refNumber: '',
        monthKey: '',
      },
      ctx({ rateHistory: history }),
    );
    expect(d.length).toBe(0);   // no pay rate → no drift signal
  });

  it('skips when invoice rate is missing', () => {
    const d = detectDiscrepancies(
      {
        invoiceRate: null,
        invoicePeriodEnd: '2026-06-30',
        invoiceUserId: 'user-a',
        vendorListId: null,
        vendorName: 'X',
        refNumber: '',
        monthKey: '',
      },
      ctx({ rateHistory }),
    );
    expect(d.length).toBe(0);
  });
});

describe('detectDiscrepancies — umbrella mismap', () => {
  it('flags when vendor serves multiple contractors', () => {
    const vendorContractors = new Map<string, Set<string>>([
      ['V-TEAL', new Set(['user-a', 'user-b', 'user-c'])],
    ]);
    const d = detectDiscrepancies(
      {
        invoiceRate: null,
        invoicePeriodEnd: '',
        invoiceUserId: null,
        vendorListId: 'V-TEAL',
        vendorName: 'Teal Crossroads',
        refNumber: '',
        monthKey: '',
      },
      ctx({ vendorContractors }),
    );
    expect(d.length).toBe(1);
    expect(d[0].kind).toBe('umbrella_mismap');
    expect(d[0].message).toMatch(/3 contractors/);
  });

  it('does not flag single-contractor vendors', () => {
    const vendorContractors = new Map<string, Set<string>>([
      ['V-SOLO', new Set(['user-a'])],
    ]);
    const d = detectDiscrepancies(
      {
        invoiceRate: null,
        invoicePeriodEnd: '',
        invoiceUserId: null,
        vendorListId: 'V-SOLO',
        vendorName: 'Yara Solutions',
        refNumber: '',
        monthKey: '',
      },
      ctx({ vendorContractors }),
    );
    expect(d.length).toBe(0);
  });
});

describe('detectDiscrepancies — duplicate RefNumber', () => {
  it('flags when a bill with same (vendor, ref) exists in a different month', () => {
    const openBills = [
      { vendorListId: 'V-A', refNumber: 'INV-12', txnDate: '2023-12-15' },
    ];
    const d = detectDiscrepancies(
      {
        invoiceRate: null,
        invoicePeriodEnd: '',
        invoiceUserId: null,
        vendorListId: 'V-A',
        vendorName: 'Yara',
        refNumber: 'INV-12',
        monthKey: '2026-07',
      },
      ctx({ openBills }),
    );
    expect(d.length).toBe(1);
    expect(d[0].kind).toBe('duplicate_refnumber');
    expect(d[0].message).toMatch(/INV-12/);
  });

  it('does not flag when the collision is in the same month (this IS the row)', () => {
    const openBills = [
      { vendorListId: 'V-A', refNumber: 'INV-12', txnDate: '2026-07-15' },
    ];
    const d = detectDiscrepancies(
      {
        invoiceRate: null,
        invoicePeriodEnd: '',
        invoiceUserId: null,
        vendorListId: 'V-A',
        vendorName: 'Yara',
        refNumber: 'INV-12',
        monthKey: '2026-07',
      },
      ctx({ openBills }),
    );
    expect(d.length).toBe(0);
  });

  it('normalizes stacked "INV" prefixes for comparison', () => {
    const openBills = [
      { vendorListId: 'V-A', refNumber: 'INV-12', txnDate: '2023-12-15' },
    ];
    const d = detectDiscrepancies(
      {
        invoiceRate: null,
        invoicePeriodEnd: '',
        invoiceUserId: null,
        vendorListId: 'V-A',
        vendorName: 'Yara',
        refNumber: 'Inv# INV-12',
        monthKey: '2026-07',
      },
      ctx({ openBills }),
    );
    expect(d.length).toBe(1);
  });
});

describe('detectDiscrepancies — multiple rules', () => {
  it('accumulates all applicable discrepancies for a row', () => {
    const rateHistory: RateHistoryEntry[] = [
      { userId: 'user-a', rateKind: 'pay', rate: 40, effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const vendorContractors = new Map<string, Set<string>>([
      ['V-TEAL', new Set(['user-a', 'user-b'])],
    ]);
    const openBills = [
      { vendorListId: 'V-TEAL', refNumber: 'INV-1', txnDate: '2023-12-15' },
    ];
    const d = detectDiscrepancies(
      {
        invoiceRate: 35,   // drift vs 40
        invoicePeriodEnd: '2026-06-30',
        invoiceUserId: 'user-a',
        vendorListId: 'V-TEAL',
        vendorName: 'Teal Crossroads',
        refNumber: 'INV-1',
        monthKey: '2026-07',
      },
      { rateHistory, vendorContractors, openBills },
    );
    expect(d.length).toBe(3);
    expect(d.map(x => x.kind).sort()).toEqual(['duplicate_refnumber', 'rate_drift', 'umbrella_mismap']);
  });

  it('returns empty when nothing is off', () => {
    const d = detectDiscrepancies(
      {
        invoiceRate: 40,
        invoicePeriodEnd: '2026-06-30',
        invoiceUserId: 'user-a',
        vendorListId: 'V-A',
        vendorName: 'Yara',
        refNumber: 'INV-1',
        monthKey: '2026-07',
      },
      ctx({
        rateHistory: [{ userId: 'user-a', rateKind: 'pay', rate: 40, effectiveFrom: '2026-01-01', effectiveTo: null }],
        vendorContractors: new Map([['V-A', new Set(['user-a'])]]),
        openBills: [],
      }),
    );
    expect(d.length).toBe(0);
  });
});
