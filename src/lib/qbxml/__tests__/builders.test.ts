import { describe, it, expect } from 'vitest';
import { buildBillAddRq, buildBillQueryRq } from '../builders';
import { wrapQbxmlRequests, xmlEscape } from '../envelope';
import { DEFAULT_AP_ACCOUNT, DEFAULT_EXPENSE_ACCOUNT } from '../constants';

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

describe('buildBillAddRq', () => {
  const baseSingleLine = {
    vendorName: 'Bimosoft - Amar Pljevljak',
    txnDate: '2026-05-31',
    dueDate: '2026-06-30',
    refNumber: 'INV 178329594109',
    memo: 'May 2026 — 30h @ $35 — Amar Pljevljak',
    lines: [{
      amount: 1050,
      memo: 'May 2026 — 30h @ $35 — Amar Pljevljak — INV 178329594109',
    }],
  };

  it('emits a minimal single-line bill with all required elements', () => {
    const out = buildBillAddRq(baseSingleLine);
    expect(out).toContain('<BillAddRq>');
    expect(out).toContain('<BillAdd>');
    expect(out).toContain('<VendorRef>');
    expect(out).toContain('<FullName>Bimosoft - Amar Pljevljak</FullName>');
    expect(out).toContain('</VendorRef>');
    expect(out).toContain('<APAccountRef>');
    expect(out).toContain(`<FullName>${DEFAULT_AP_ACCOUNT}</FullName>`);
    expect(out).toContain('<TxnDate>2026-05-31</TxnDate>');
    expect(out).toContain('<DueDate>2026-06-30</DueDate>');
    expect(out).toContain('<RefNumber>INV 178329594109</RefNumber>');
    expect(out).toContain('<Memo>May 2026 — 30h @ $35 — Amar Pljevljak</Memo>');
    expect(out).toContain('<ExpenseLineAdd>');
    expect(out).toContain(`<FullName>${DEFAULT_EXPENSE_ACCOUNT}</FullName>`);
    expect(out).toContain('<Amount>1050.00</Amount>');
    expect(out).toContain('</ExpenseLineAdd>');
    expect(out).toContain('</BillAdd>');
    expect(out).toContain('</BillAddRq>');
  });

  it('emits elements in the strict qbXML spec order', () => {
    // Element order is one of the top reasons QB rejects a request. Lock it.
    const out = buildBillAddRq(baseSingleLine);
    const order = [
      '<VendorRef>',
      '<APAccountRef>',
      '<TxnDate>',
      '<DueDate>',
      '<RefNumber>',
      '<Memo>',
      '<ExpenseLineAdd>',
    ];
    let cursor = 0;
    for (const tag of order) {
      const idx = out.indexOf(tag, cursor);
      expect(idx, `${tag} should appear after cursor ${cursor}`).toBeGreaterThan(-1);
      cursor = idx;
    }
  });

  it('emits ExpenseLineAdd inner elements in AccountRef → Amount → Memo order', () => {
    const out = buildBillAddRq(baseSingleLine);
    const acctIdx = out.indexOf('<AccountRef>');
    const amtIdx = out.indexOf('<Amount>');
    const memoIdx = out.indexOf('<Memo>May 2026 — 30h @ $35 — Amar Pljevljak — INV');
    expect(acctIdx).toBeLessThan(amtIdx);
    expect(amtIdx).toBeLessThan(memoIdx);
  });

  it('formats Amount with exactly two decimal places', () => {
    // Currency: 2dp is canonical. Guards against JS float noise like 1050.0000001.
    expect(buildBillAddRq({ ...baseSingleLine, lines: [{ amount: 1050 }] }))
      .toContain('<Amount>1050.00</Amount>');
    expect(buildBillAddRq({ ...baseSingleLine, lines: [{ amount: 1050.1 }] }))
      .toContain('<Amount>1050.10</Amount>');
    expect(buildBillAddRq({ ...baseSingleLine, lines: [{ amount: 1050.126 }] }))
      .toContain('<Amount>1050.13</Amount>');
  });

  it('supports multi-line combined bills (umbrella vendors)', () => {
    const out = buildBillAddRq({
      vendorName: 'Teal Crossroads',
      txnDate: '2026-05-31',
      refNumber: 'M-202605',
      memo: 'May 2026 — 3 contractors — 120h total',
      lines: [
        { amount: 1400, memo: 'May 2026 — 40h @ $35 — Aleksandar Brajkovic — INV 03/26' },
        { amount: 1600, memo: 'May 2026 — 40h @ $40 — Zlatan Bekric — INV 03/26' },
        { amount: 1200, memo: 'May 2026 — 40h @ $30 — Ivica Zlatar — INV 7-1-1' },
      ],
    });
    // Three ExpenseLineAdd blocks
    const opens = (out.match(/<ExpenseLineAdd>/g) ?? []).length;
    const closes = (out.match(/<\/ExpenseLineAdd>/g) ?? []).length;
    expect(opens).toBe(3);
    expect(closes).toBe(3);
    // Each amount present
    expect(out).toContain('<Amount>1400.00</Amount>');
    expect(out).toContain('<Amount>1600.00</Amount>');
    expect(out).toContain('<Amount>1200.00</Amount>');
    // Order preserved
    const idx = (needle: string) => out.indexOf(needle);
    expect(idx('1400.00')).toBeLessThan(idx('1600.00'));
    expect(idx('1600.00')).toBeLessThan(idx('1200.00'));
  });

  it('per-line expenseAccountName overrides the default', () => {
    const out = buildBillAddRq({
      ...baseSingleLine,
      lines: [{
        amount: 1050,
        expenseAccountName: 'Special:Override:Path',
      }],
    });
    expect(out).toContain('<FullName>Special:Override:Path</FullName>');
    // Default should NOT appear in this ExpenseLineAdd block.
    expect(out).not.toContain(`<FullName>${DEFAULT_EXPENSE_ACCOUNT}</FullName>`);
  });

  it('omits DueDate when not provided (QB may fall back to TermsRef or now)', () => {
    const out = buildBillAddRq({ ...baseSingleLine, dueDate: undefined });
    expect(out).not.toContain('<DueDate>');
  });

  it('omits Memo when not provided', () => {
    const out = buildBillAddRq({ ...baseSingleLine, memo: undefined });
    // Bill-level memo omitted, but the line memo still appears.
    const memoCount = (out.match(/<Memo>/g) ?? []).length;
    expect(memoCount).toBe(1);
  });

  it('escapes XML special chars in vendor name and memos', () => {
    // Real vendor: some Croatian company names contain "&" or umlauts.
    const out = buildBillAddRq({
      vendorName: 'Vrdoljak IT, obrt & Co',
      txnDate: '2026-05-31',
      refNumber: 'INV 6-1-1',
      memo: 'May 2026 — 40h @ $30 — Josip Vrdoljak',
      lines: [{ amount: 1200, memo: 'a<b>c' }],
    });
    expect(out).toContain('Vrdoljak IT, obrt &amp; Co');
    expect(out).toContain('a&lt;b&gt;c');
  });

  it('preserves Unicode (Croatian/Serbian diacritics) as-is', () => {
    // These are NOT special chars in XML — they just need to survive.
    // QB Desktop 2020 has known encoding quirks (see GOTCHAS) but the
    // builder must pass them through cleanly regardless.
    const out = buildBillAddRq({
      vendorName: 'OBAI DRUŠTVO d.o.o.',
      txnDate: '2026-05-31',
      refNumber: 'INV 43',
      memo: 'Marta Sušek',
      lines: [{ amount: 1000, memo: 'Đđ Ž ž Č č Ć ć Š š' }],
    });
    expect(out).toContain('OBAI DRUŠTVO d.o.o.');
    expect(out).toContain('Marta Sušek');
    expect(out).toContain('Đđ Ž ž Č č Ć ć Š š');
  });

  it('carries requestID when provided', () => {
    const out = buildBillAddRq({ ...baseSingleLine, requestId: 'add-42' });
    expect(out.startsWith('<BillAddRq requestID="add-42">')).toBe(true);
  });

  it('throws on empty lines array', () => {
    expect(() => buildBillAddRq({ ...baseSingleLine, lines: [] }))
      .toThrow(/at least one line/);
  });

  it('respects apAccountName override', () => {
    const out = buildBillAddRq({
      ...baseSingleLine,
      apAccountName: 'Other:AP Path',
    });
    expect(out).toContain('<FullName>Other:AP Path</FullName>');
    expect(out).not.toContain(`<FullName>${DEFAULT_AP_ACCOUNT}</FullName>`);
  });

  it('respects defaultExpenseAccountName override', () => {
    const out = buildBillAddRq({
      ...baseSingleLine,
      defaultExpenseAccountName: 'Custom:Expense',
    });
    expect(out).toContain('<FullName>Custom:Expense</FullName>');
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
