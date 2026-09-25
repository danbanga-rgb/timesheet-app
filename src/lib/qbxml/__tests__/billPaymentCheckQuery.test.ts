import { describe, it, expect } from 'vitest';
import { buildBillPaymentCheckQueryRq } from '../builders';

describe('buildBillPaymentCheckQueryRq', () => {
  it('delta mode: MaxReturned first, wrapped ModifiedDateRangeFilter, IncludeLineItems last', () => {
    const xml = buildBillPaymentCheckQueryRq({ fromModifiedDate: '2026-09-25T09:47:00', maxReturned: 200, requestId: '7' });
    expect(xml.startsWith('<BillPaymentCheckQueryRq requestID="7">')).toBe(true);
    const iMax = xml.indexOf('<MaxReturned>200</MaxReturned>');
    const iMod = xml.indexOf('<ModifiedDateRangeFilter>');
    const iFrom = xml.indexOf('<FromModifiedDate>2026-09-25T09:47:00</FromModifiedDate>');
    const iInc = xml.indexOf('<IncludeLineItems>true</IncludeLineItems>');
    expect(iMax).toBeGreaterThan(0);
    expect(iMod).toBeGreaterThan(iMax);
    expect(iFrom).toBeGreaterThan(iMod);
    expect(iInc).toBeGreaterThan(xml.indexOf('</ModifiedDateRangeFilter>'));
    expect(xml).not.toContain('TxnDateRangeFilter');
    expect(xml).not.toContain('EntityFilter');
  });

  it('vendor iterator: TxnDateRangeFilter before EntityFilter', () => {
    const xml = buildBillPaymentCheckQueryRq({ entityVendorName: 'Zex Network PRO', fromTxnDate: '2026-01-01', toTxnDate: '2026-09-01' });
    expect(xml.indexOf('<TxnDateRangeFilter>')).toBeLessThan(xml.indexOf('<EntityFilter>'));
    expect(xml).toContain('<FullName>Zex Network PRO</FullName>');
    expect(xml).toContain('<IncludeLineItems>true</IncludeLineItems>');
  });

  it('includeLineItems=false omits the element', () => {
    expect(buildBillPaymentCheckQueryRq({ entityVendorName: 'X', includeLineItems: false })).not.toContain('IncludeLineItems');
  });

  it('rejects modified + txn date together, and an empty filter', () => {
    expect(() => buildBillPaymentCheckQueryRq({ fromModifiedDate: '2026-09-25T00:00:00', fromTxnDate: '2026-09-01' })).toThrow(/mutually exclusive/);
    expect(() => buildBillPaymentCheckQueryRq({})).toThrow(/supply/);
  });

  it('escapes vendor names', () => {
    expect(buildBillPaymentCheckQueryRq({ entityVendorName: 'A & B' })).toContain('<FullName>A &amp; B</FullName>');
  });
});
