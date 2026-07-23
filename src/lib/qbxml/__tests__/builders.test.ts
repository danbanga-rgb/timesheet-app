import { describe, it, expect } from 'vitest';
import { buildBillQueryRq } from '../builders';
import { wrapQbxmlRequests, xmlEscape } from '../envelope';

describe('xmlEscape', () => {
  it('escapes the five XML special chars', () => {
    expect(xmlEscape('a & b')).toBe('a &amp; b');
    expect(xmlEscape('a < b')).toBe('a &lt; b');
    expect(xmlEscape('a > b')).toBe('a &gt; b');
    expect(xmlEscape('a " b')).toBe('a &quot; b');
    expect(xmlEscape("a ' b")).toBe('a &apos; b');
  });

  it('escapes & first so we do not double-escape entities', () => {
    // If & were escaped after < → we would emit &amp;lt; instead of &lt;.
    expect(xmlEscape('<&>')).toBe('&lt;&amp;&gt;');
  });
});

describe('buildBillQueryRq', () => {
  it('emits a single RefNumberList entry for one ref', () => {
    const out = buildBillQueryRq({ refNumbers: ['INV 43'] });
    expect(out).toBe(
      [
        '<BillQueryRq>',
        '  <RefNumberList>INV 43</RefNumberList>',
        '  <IncludeLineItems>false</IncludeLineItems>',
        '</BillQueryRq>',
      ].join('\n'),
    );
  });

  it('emits one RefNumberList element per ref for multiple refs', () => {
    const out = buildBillQueryRq({
      refNumbers: ['INV 178329594109', 'INV 002/07/2026', 'INV NT-cb019b'],
    });
    expect(out).toContain('<RefNumberList>INV 178329594109</RefNumberList>');
    expect(out).toContain('<RefNumberList>INV 002/07/2026</RefNumberList>');
    expect(out).toContain('<RefNumberList>INV NT-cb019b</RefNumberList>');
    // Order preserved
    const idx = (needle: string) => out.indexOf(needle);
    expect(idx('178329594109')).toBeLessThan(idx('002/07/2026'));
    expect(idx('002/07/2026')).toBeLessThan(idx('NT-cb019b'));
  });

  it('includes requestID as an attribute when provided', () => {
    const out = buildBillQueryRq({
      refNumbers: ['INV 43'],
      requestId: 'q-42',
    });
    expect(out.startsWith('<BillQueryRq requestID="q-42">')).toBe(true);
  });

  it('omits requestID attribute when not provided', () => {
    const out = buildBillQueryRq({ refNumbers: ['INV 43'] });
    expect(out.startsWith('<BillQueryRq>')).toBe(true);
    expect(out).not.toContain('requestID');
  });

  it('includes MaxReturned when provided', () => {
    const out = buildBillQueryRq({
      refNumbers: ['INV 43'],
      maxReturned: 100,
    });
    expect(out).toContain('<MaxReturned>100</MaxReturned>');
  });

  it('omits MaxReturned when not provided', () => {
    const out = buildBillQueryRq({ refNumbers: ['INV 43'] });
    expect(out).not.toContain('MaxReturned');
  });

  it('always sets IncludeLineItems=false (header-only response)', () => {
    // We only need TxnID for the query-then-apply flow — line detail is wasted bandwidth.
    const out = buildBillQueryRq({ refNumbers: ['INV 43'] });
    expect(out).toContain('<IncludeLineItems>false</IncludeLineItems>');
  });

  it('throws on empty refNumbers', () => {
    // QB would accept an empty query and return every open bill — never what we want.
    // Failing fast prevents accidental full-table scans.
    expect(() => buildBillQueryRq({ refNumbers: [] })).toThrow(/must not be empty/);
  });

  it('escapes XML special chars in RefNumber values', () => {
    // Contrived — real invoice numbers don't contain <, &, etc. — but guarantee safety anyway.
    const out = buildBillQueryRq({ refNumbers: ['A&B<C>D"E\'F'] });
    expect(out).toContain(
      '<RefNumberList>A&amp;B&lt;C&gt;D&quot;E&apos;F</RefNumberList>',
    );
  });

  it('escapes XML special chars in requestId', () => {
    const out = buildBillQueryRq({
      refNumbers: ['INV 43'],
      requestId: 'a"b',
    });
    expect(out).toContain('requestID="a&quot;b"');
  });
});

describe('wrapQbxmlRequests', () => {
  it('wraps a single request in a QBXML envelope', () => {
    const req = buildBillQueryRq({ refNumbers: ['INV 43'] });
    const wrapped = wrapQbxmlRequests([req]);
    expect(wrapped).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(wrapped).toContain('<?qbxml version="13.0"?>');
    expect(wrapped).toContain('<QBXML>');
    expect(wrapped).toContain('<QBXMLMsgsRq onError="stopOnError">');
    expect(wrapped).toContain('<BillQueryRq>');
    expect(wrapped).toContain('</BillQueryRq>');
    expect(wrapped).toContain('</QBXMLMsgsRq>');
    expect(wrapped).toContain('</QBXML>');
  });

  it('supports multiple requests in one envelope', () => {
    const r1 = buildBillQueryRq({ refNumbers: ['INV 43'], requestId: '1' });
    const r2 = buildBillQueryRq({ refNumbers: ['INV 44'], requestId: '2' });
    const wrapped = wrapQbxmlRequests([r1, r2]);
    expect(wrapped).toContain('requestID="1"');
    expect(wrapped).toContain('requestID="2"');
    expect(wrapped.indexOf('requestID="1"')).toBeLessThan(wrapped.indexOf('requestID="2"'));
  });

  it('supports continueOnError override', () => {
    const req = buildBillQueryRq({ refNumbers: ['INV 43'] });
    const wrapped = wrapQbxmlRequests([req], { onError: 'continueOnError' });
    expect(wrapped).toContain('<QBXMLMsgsRq onError="continueOnError">');
  });
});
