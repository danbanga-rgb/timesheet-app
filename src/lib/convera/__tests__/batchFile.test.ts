import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  fmtConveraAmount,
  buildConveraBatchRows,
  buildConveraBatchCsv,
  computeConveraBatchFilename,
  CONVERA_INDIA_REF2,
  CONVERA_MULTI_INVOICE_REF1,
  CONVERA_CSV_HEADER,
  CONVERA_BENENAME_MAX,
  CONVERA_REF1_MAX,
  type ConveraBatchGroup,
  type ConveraBatchManualRow,
} from '../batchFile';
import type { Invoice } from '../../../types';

const inv = (over: Partial<Invoice>): Invoice => ({
  id: 1,
  invoiceNumber: 'INV-001',
  userId: 'u1',
  userName: 'X',
  projectId: null,
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  lines: [],
  totalHours: 40,
  rate: 50,
  totalAmount: 2000,
  currency: 'USD',
  status: 'approved',
  submittedAt: null,
  reviewedAt: null,
  reviewedBy: null,
  notes: '',
  paymentProfile: null,
  payOnDate: null,
  paidDate: null,
  attachmentPath: null,
  paymentMethodOverride: null,
  isVendorInvoice: false,
  vendorManagerId: null,
  source: 'direct',
  createdBy: null,
  reconciliationStatus: null,
  reconciliationDelta: null,
  reconciliationNotes: null,
  groupKey: null,
  corrected: false,
  paymentTerms: null,
  qbExportStatus: 'not_exported',
  qbExportStatusAt: null,
  qbBillTxnId: null,
  matcherIgnore: false,
  editHistory: [],
  ...over,
});

const grp = (over: Partial<ConveraBatchGroup>): ConveraBatchGroup => ({
  key: 'b1',
  vendorId: 'SYN-0001',
  shortName: 'ACME',
  fullName: 'Acme Beneficiary Ltd',
  entries: [],
  distinctIbans: 1,
  anyIndia: false,
  ...over,
});

describe('csvEscape', () => {
  it('leaves plain strings untouched', () => {
    expect(csvEscape('SYN-0001')).toBe('SYN-0001');
    expect(csvEscape('Acme Corp Ltd')).toBe('Acme Corp Ltd');
    expect(csvEscape('')).toBe('');
  });
  it('wraps commas in quotes', () => {
    expect(csvEscape('Acme, Inc')).toBe('"Acme, Inc"');
  });
  it('wraps newlines in quotes', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
  it('escapes embedded quotes by doubling and wraps', () => {
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
  });
});

describe('fmtConveraAmount', () => {
  it('integers rendered without decimal', () => {
    expect(fmtConveraAmount(2000)).toBe('2000');
    expect(fmtConveraAmount(0)).toBe('0');
    expect(fmtConveraAmount(1)).toBe('1');
  });
  it('fractional amounts get .XX', () => {
    expect(fmtConveraAmount(1234.5)).toBe('1234.50');
    expect(fmtConveraAmount(99.99)).toBe('99.99');
  });
});

describe('buildConveraBatchRows — non-combined groups', () => {
  it('single-entry group emits one row with invoice-number ref1', () => {
    const groups = [grp({
      entries: [{ inv: inv({ id: 1, invoiceNumber: 'INV-A', totalAmount: 500 }), iban: 'GB00' }],
    })];
    const rows = buildConveraBatchRows(groups, {}, []);
    expect(rows).toEqual([
      { vendorId: 'SYN-0001', beneName: 'ACME', amount: 500, ref1: 'INV-A', ref2: '' },
    ]);
  });

  it('multi-entry group with combineChoices false → one row per entry', () => {
    const groups = [grp({
      entries: [
        { inv: inv({ id: 1, invoiceNumber: 'INV-A', totalAmount: 100 }), iban: 'GB00' },
        { inv: inv({ id: 2, invoiceNumber: 'INV-B', totalAmount: 200 }), iban: 'GB01' },
      ],
    })];
    const rows = buildConveraBatchRows(groups, { b1: false }, []);
    expect(rows).toHaveLength(2);
    expect(rows[0].ref1).toBe('INV-A');
    expect(rows[1].ref1).toBe('INV-B');
    expect(rows[0].amount).toBe(100);
    expect(rows[1].amount).toBe(200);
  });
});

describe('buildConveraBatchRows — combined groups (TEAL umbrella + generic)', () => {
  it('combined group with SAME invoice_number across entries → shared ref1 (TEAL umbrella)', () => {
    const groups = [grp({
      key: 'teal',
      vendorId: 'SYN-TEAL',
      shortName: 'TEAL',
      entries: [
        { inv: inv({ id: 1, invoiceNumber: 'TEAL-INV-42', totalAmount: 1000 }), iban: 'GB00' },
        { inv: inv({ id: 2, invoiceNumber: 'TEAL-INV-42', totalAmount: 2000 }), iban: 'GB00' },
        { inv: inv({ id: 3, invoiceNumber: 'TEAL-INV-42', totalAmount: 3000 }), iban: 'GB00' },
      ],
    })];
    const rows = buildConveraBatchRows(groups, { teal: true }, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].ref1).toBe('TEAL-INV-42');
    expect(rows[0].amount).toBe(6000);
    expect(rows[0].vendorId).toBe('SYN-TEAL');
  });

  it('combined group with DIFFERENT invoice_numbers → ref1 = "Multiple Invoices"', () => {
    const groups = [grp({
      key: 'bim',
      shortName: 'BIMOSOFT',
      entries: [
        { inv: inv({ id: 1, invoiceNumber: 'INV-A', totalAmount: 100 }), iban: 'GB00' },
        { inv: inv({ id: 2, invoiceNumber: 'INV-B', totalAmount: 200 }), iban: 'GB00' },
      ],
    })];
    const rows = buildConveraBatchRows(groups, { bim: true }, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].ref1).toBe(CONVERA_MULTI_INVOICE_REF1);
    expect(rows[0].ref1).toBe('Multiple Invoices');
    expect(rows[0].amount).toBe(300);
  });

  it('single-entry group with combineChoices=true is NOT combined (needs entries.length > 1)', () => {
    const groups = [grp({
      key: 'solo',
      entries: [{ inv: inv({ id: 1, invoiceNumber: 'INV-SOLO', totalAmount: 500 }), iban: 'GB00' }],
    })];
    const rows = buildConveraBatchRows(groups, { solo: true }, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].ref1).toBe('INV-SOLO');
  });
});

describe('buildConveraBatchRows — 100-char caps', () => {
  it('beneName capped at 100 chars', () => {
    const longName = 'A'.repeat(150);
    const groups = [grp({
      shortName: longName,
      entries: [{ inv: inv({ id: 1, invoiceNumber: 'X', totalAmount: 100 }), iban: 'GB00' }],
    })];
    const rows = buildConveraBatchRows(groups, {}, []);
    expect(rows[0].beneName.length).toBe(CONVERA_BENENAME_MAX);
    expect(rows[0].beneName).toBe('A'.repeat(100));
  });

  it('beneName falls back to fullName when shortName empty', () => {
    const groups = [grp({
      shortName: '',
      fullName: 'Fallback Full Name Ltd',
      entries: [{ inv: inv({ id: 1, invoiceNumber: 'X', totalAmount: 100 }), iban: 'GB00' }],
    })];
    const rows = buildConveraBatchRows(groups, {}, []);
    expect(rows[0].beneName).toBe('Fallback Full Name Ltd');
  });

  it('ref1 (per-entry) capped at 100 chars', () => {
    const longInv = 'INV-' + 'X'.repeat(200);
    const groups = [grp({
      entries: [{ inv: inv({ id: 1, invoiceNumber: longInv, totalAmount: 100 }), iban: 'GB00' }],
    })];
    const rows = buildConveraBatchRows(groups, {}, []);
    expect(rows[0].ref1.length).toBe(CONVERA_REF1_MAX);
  });

  it('ref1 (shared TEAL) capped at 100 chars', () => {
    const longInv = 'T'.repeat(200);
    const groups = [grp({
      key: 'teal',
      entries: [
        { inv: inv({ id: 1, invoiceNumber: longInv, totalAmount: 100 }), iban: 'GB00' },
        { inv: inv({ id: 2, invoiceNumber: longInv, totalAmount: 100 }), iban: 'GB00' },
      ],
    })];
    const rows = buildConveraBatchRows(groups, { teal: true }, []);
    expect(rows[0].ref1.length).toBe(CONVERA_REF1_MAX);
  });
});

describe('buildConveraBatchRows — India Ref2 rule', () => {
  it('group with anyIndia=true → all rows get PURPOSE OF FUNDS P0802', () => {
    const groups = [grp({
      anyIndia: true,
      entries: [
        { inv: inv({ id: 1, invoiceNumber: 'A', totalAmount: 100 }), iban: 'IN00' },
        { inv: inv({ id: 2, invoiceNumber: 'B', totalAmount: 200 }), iban: 'IN00' },
      ],
    })];
    const rows = buildConveraBatchRows(groups, {}, []);
    expect(rows[0].ref2).toBe(CONVERA_INDIA_REF2);
    expect(rows[1].ref2).toBe(CONVERA_INDIA_REF2);
    expect(CONVERA_INDIA_REF2).toBe('PURPOSE OF FUNDS P0802');
  });

  it('group with anyIndia=false → empty ref2', () => {
    const groups = [grp({
      anyIndia: false,
      entries: [{ inv: inv({ id: 1, invoiceNumber: 'A', totalAmount: 100 }), iban: 'GB00' }],
    })];
    const rows = buildConveraBatchRows(groups, {}, []);
    expect(rows[0].ref2).toBe('');
  });

  it('manual row with country="India" → PURPOSE OF FUNDS P0802', () => {
    const manual: ConveraBatchManualRow = {
      id: 'm1', beneficiaryId: 5, shortName: 'MANUAL',
      vendorId: 'SYN-9', country: 'India', amount: 500, ref1: 'MANUAL-REF',
    };
    const rows = buildConveraBatchRows([], {}, [manual]);
    expect(rows[0].ref2).toBe(CONVERA_INDIA_REF2);
  });

  it('manual row with non-India country → empty ref2', () => {
    const manual: ConveraBatchManualRow = {
      id: 'm1', beneficiaryId: 5, shortName: 'MANUAL',
      vendorId: 'SYN-9', country: 'UK', amount: 500, ref1: 'MANUAL-REF',
    };
    const rows = buildConveraBatchRows([], {}, [manual]);
    expect(rows[0].ref2).toBe('');
  });
});

describe('buildConveraBatchRows — manual rows appended after groups', () => {
  it('manual rows come AFTER group rows in output', () => {
    const groups = [grp({
      entries: [{ inv: inv({ id: 1, invoiceNumber: 'A', totalAmount: 100 }), iban: 'GB00' }],
    })];
    const manual: ConveraBatchManualRow = {
      id: 'm1', beneficiaryId: 5, shortName: 'MANUAL',
      vendorId: 'SYN-9', country: 'UK', amount: 500, ref1: 'MANUAL-REF',
    };
    const rows = buildConveraBatchRows(groups, {}, [manual]);
    expect(rows).toHaveLength(2);
    expect(rows[0].vendorId).toBe('SYN-0001');
    expect(rows[1].vendorId).toBe('SYN-9');
  });

  it('manual rows respect 100-char caps on shortName + ref1', () => {
    const manual: ConveraBatchManualRow = {
      id: 'm1', beneficiaryId: 5, shortName: 'X'.repeat(200),
      vendorId: 'SYN-9', country: 'UK', amount: 500, ref1: 'Y'.repeat(200),
    };
    const rows = buildConveraBatchRows([], {}, [manual]);
    expect(rows[0].beneName.length).toBe(CONVERA_BENENAME_MAX);
    expect(rows[0].ref1.length).toBe(CONVERA_REF1_MAX);
  });
});

describe('buildConveraBatchCsv — Convera format contract', () => {
  it('emits header first, then rows', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'SYN-1', beneName: 'ACME', amount: 100, ref1: 'INV-A', ref2: '' },
    ]);
    const [line1, line2] = csv.split('\r\n');
    expect(line1).toBe(CONVERA_CSV_HEADER);
    expect(line2).toBe('SYN-1,ACME,100,INV-A,,Trade Related');
  });

  it('uses CRLF line endings (\\r\\n), NOT LF', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'A', beneName: 'B', amount: 1, ref1: 'C', ref2: '' },
    ]);
    expect(csv).toContain('\r\n');
    // No bare LF anywhere
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('no trailing newline', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'A', beneName: 'B', amount: 1, ref1: 'C', ref2: '' },
    ]);
    expect(csv.endsWith('\n')).toBe(false);
    expect(csv.endsWith('\r')).toBe(false);
  });

  it('no UTF-8 BOM prefix', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'A', beneName: 'B', amount: 1, ref1: 'C', ref2: '' },
    ]);
    expect(csv.charCodeAt(0)).not.toBe(0xFEFF);
    expect(csv.charCodeAt(0)).toBe('V'.charCodeAt(0)); // starts with header
  });

  it('POP column always "Trade Related"', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'A', beneName: 'B', amount: 1, ref1: 'C', ref2: 'D' },
    ]);
    expect(csv).toContain(',Trade Related');
  });

  it('amount uses integer format for whole dollars', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'A', beneName: 'B', amount: 500, ref1: 'C', ref2: '' },
    ]);
    expect(csv).toContain(',B,500,C,');
    expect(csv).not.toContain(',500.00,');
  });

  it('amount uses .XX for real cents', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'A', beneName: 'B', amount: 99.5, ref1: 'C', ref2: '' },
    ]);
    expect(csv).toContain(',99.50,');
  });

  it('field with comma gets quoted in output', () => {
    const csv = buildConveraBatchCsv([
      { vendorId: 'A', beneName: 'Foo, Bar', amount: 1, ref1: 'C', ref2: '' },
    ]);
    expect(csv).toContain(',"Foo, Bar",');
  });

  it('empty rows produces header-only CSV', () => {
    expect(buildConveraBatchCsv([])).toBe(CONVERA_CSV_HEADER);
  });
});

describe('computeConveraBatchFilename', () => {
  it('returns most-common payOnDate slug (YYYYMMDD)', () => {
    const invs = [
      inv({ id: 1, payOnDate: '2026-09-15' }),
      inv({ id: 2, payOnDate: '2026-09-15' }),
      inv({ id: 3, payOnDate: '2026-09-30' }),
    ];
    expect(computeConveraBatchFilename(invs)).toBe('20260915');
  });

  it('picks the highest-count date when tied — deterministic on iteration order', () => {
    const invs = [
      inv({ id: 1, payOnDate: '2026-09-15' }),
      inv({ id: 2, payOnDate: '2026-09-30' }),
    ];
    const result = computeConveraBatchFilename(invs);
    expect(['20260915', '20260930']).toContain(result);
  });

  it('falls back to today when no invoice has a payOnDate', () => {
    const invs = [inv({ id: 1, payOnDate: null })];
    const result = computeConveraBatchFilename(invs);
    expect(result).toMatch(/^\d{8}$/);
  });

  it('ignores invoices with null payOnDate', () => {
    const invs = [
      inv({ id: 1, payOnDate: null }),
      inv({ id: 2, payOnDate: '2026-10-01' }),
    ];
    expect(computeConveraBatchFilename(invs)).toBe('20261001');
  });
});
