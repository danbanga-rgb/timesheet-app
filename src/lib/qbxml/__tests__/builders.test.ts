import { describe, it, expect } from 'vitest';
import {
  buildBillAddRq,
  buildBillPaymentCheckAddRq,
  buildBillQueryRq,
} from '../builders';
import { wrapQbxmlRequests, xmlEscape } from '../envelope';
import {
  DEFAULT_AP_ACCOUNT,
  DEFAULT_EXPENSE_ACCOUNT,
  WU_HOLDING,
} from '../constants';

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

describe('buildBillPaymentCheckAddRq', () => {
  // Base fixture: mirrors a real Convera wire — one bill, one vendor,
  // wire confirmation as RefNumber, WU Holding as bank account.
  const baseSinglePayment = {
    payeeVendorName: 'Bimosoft - Amar Pljevljak',
    txnDate: '2026-06-30',
    bankAccountName: WU_HOLDING,
    refNumber: 'OTR6607568',
    memo: 'Convera wire — INV 178329594109 — Amar Pljevljak',
    applications: [{
      billTxnId: '12006-1196864828',
      paymentAmount: 1050,
    }],
  };

  it('emits a minimal valid payment with all required elements', () => {
    const out = buildBillPaymentCheckAddRq(baseSinglePayment);
    expect(out).toContain('<BillPaymentCheckAddRq>');
    expect(out).toContain('<BillPaymentCheckAdd>');
    expect(out).toContain('<PayeeEntityRef>');
    expect(out).toContain('<FullName>Bimosoft - Amar Pljevljak</FullName>');
    expect(out).toContain('</PayeeEntityRef>');
    expect(out).toContain('<APAccountRef>');
    expect(out).toContain(`<FullName>${DEFAULT_AP_ACCOUNT}</FullName>`);
    expect(out).toContain('<TxnDate>2026-06-30</TxnDate>');
    expect(out).toContain('<BankAccountRef>');
    expect(out).toContain(`<FullName>${WU_HOLDING}</FullName>`);
    expect(out).toContain('<RefNumber>OTR6607568</RefNumber>');
    expect(out).toContain('<Memo>Convera wire — INV 178329594109 — Amar Pljevljak</Memo>');
    expect(out).toContain('<AppliedToTxnAdd>');
    expect(out).toContain('<TxnID>12006-1196864828</TxnID>');
    expect(out).toContain('<PaymentAmount>1050.00</PaymentAmount>');
    expect(out).toContain('</AppliedToTxnAdd>');
    expect(out).toContain('</BillPaymentCheckAdd>');
    expect(out).toContain('</BillPaymentCheckAddRq>');
  });

  it('emits BillPaymentCheckAdd children in the strict qbXML spec order', () => {
    // Order-lock test. QB rejects out-of-order children with a schema error.
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      isToBePrinted: false,
    });
    const order = [
      '<PayeeEntityRef>',
      '<APAccountRef>',
      '<TxnDate>',
      '<BankAccountRef>',
      '<RefNumber>',
      '<Memo>',
      '<IsToBePrinted>',
      '<AppliedToTxnAdd>',
    ];
    let cursor = 0;
    for (const tag of order) {
      const idx = out.indexOf(tag, cursor);
      expect(idx, `${tag} should appear after cursor ${cursor}`).toBeGreaterThan(-1);
      cursor = idx;
    }
  });

  it('emits AppliedToTxnAdd inner elements in TxnID → PaymentAmount → Discount* → SetCredit* order', () => {
    // Second order-lock test — for the inner element. Element order inside
    // AppliedToTxnAdd is a separate schema check by QB.
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [{
        billTxnId: '12006-1196864828',
        paymentAmount: 950,
        discountAmount: 100,
        discountAccountName: 'Discounts Taken',
        discountClassName: 'Early Pay',
        setCredits: [{
          creditTxnId: '12345-9999999999',
          appliedAmount: 50,
        }],
      }],
    });
    const order = [
      '<TxnID>',
      '<PaymentAmount>',
      '<DiscountAmount>',
      '<DiscountAccountRef>',
      '<DiscountClassRef>',
      '<SetCredit>',
    ];
    let cursor = 0;
    for (const tag of order) {
      const idx = out.indexOf(tag, cursor);
      expect(idx, `${tag} should appear after cursor ${cursor}`).toBeGreaterThan(-1);
      cursor = idx;
    }
  });

  it('emits SetCredit inner elements in CreditTxnID → AppliedAmount → Override order', () => {
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [{
        billTxnId: '12006-1196864828',
        paymentAmount: 1000,
        setCredits: [{
          creditTxnId: '99999-1111111111',
          appliedAmount: 50,
          override: true,
        }],
      }],
    });
    const credIdx = out.indexOf('<CreditTxnID>');
    const appIdx  = out.indexOf('<AppliedAmount>');
    const ovrIdx  = out.indexOf('<Override>');
    expect(credIdx).toBeLessThan(appIdx);
    expect(appIdx).toBeLessThan(ovrIdx);
  });

  it('supports multiple AppliedToTxnAdd blocks (one payment covering many bills)', () => {
    // This is the whole point of TxnID-based auto-apply — one wire covers many bills.
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [
        { billTxnId: '12006-AAAAAAAAAA', paymentAmount: 400 },
        { billTxnId: '12006-BBBBBBBBBB', paymentAmount: 350 },
        { billTxnId: '12006-CCCCCCCCCC', paymentAmount: 300 },
      ],
    });
    const opens = (out.match(/<AppliedToTxnAdd>/g) ?? []).length;
    const closes = (out.match(/<\/AppliedToTxnAdd>/g) ?? []).length;
    expect(opens).toBe(3);
    expect(closes).toBe(3);
    expect(out).toContain('<TxnID>12006-AAAAAAAAAA</TxnID>');
    expect(out).toContain('<TxnID>12006-BBBBBBBBBB</TxnID>');
    expect(out).toContain('<TxnID>12006-CCCCCCCCCC</TxnID>');
    expect(out).toContain('<PaymentAmount>400.00</PaymentAmount>');
    expect(out).toContain('<PaymentAmount>350.00</PaymentAmount>');
    expect(out).toContain('<PaymentAmount>300.00</PaymentAmount>');
    // Order preserved
    const idx = (needle: string) => out.indexOf(needle);
    expect(idx('AAAAAAAAAA')).toBeLessThan(idx('BBBBBBBBBB'));
    expect(idx('BBBBBBBBBB')).toBeLessThan(idx('CCCCCCCCCC'));
  });

  it('supports multiple SetCredit blocks per application', () => {
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [{
        billTxnId: '12006-1196864828',
        paymentAmount: 500,
        setCredits: [
          { creditTxnId: 'CREDIT-1', appliedAmount: 100 },
          { creditTxnId: 'CREDIT-2', appliedAmount: 200 },
        ],
      }],
    });
    const opens = (out.match(/<SetCredit>/g) ?? []).length;
    expect(opens).toBe(2);
    expect(out).toContain('<CreditTxnID>CREDIT-1</CreditTxnID>');
    expect(out).toContain('<CreditTxnID>CREDIT-2</CreditTxnID>');
    expect(out).toContain('<AppliedAmount>100.00</AppliedAmount>');
    expect(out).toContain('<AppliedAmount>200.00</AppliedAmount>');
  });

  it('formats PaymentAmount and DiscountAmount and AppliedAmount with 2dp', () => {
    // Currency-precision guard, mirrors buildBillAddRq's Amount test.
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [{
        billTxnId: '12006-1196864828',
        paymentAmount: 950.126,
        discountAmount: 49.874,
        discountAccountName: 'Discounts Taken',
        setCredits: [{ creditTxnId: 'C1', appliedAmount: 0.1 }],
      }],
    });
    expect(out).toContain('<PaymentAmount>950.13</PaymentAmount>');
    expect(out).toContain('<DiscountAmount>49.87</DiscountAmount>');
    expect(out).toContain('<AppliedAmount>0.10</AppliedAmount>');
  });

  it('throws on empty applications array', () => {
    expect(() => buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [],
    })).toThrow(/at least one application/);
  });

  it('throws when refNumber exceeds 11 chars (BillPaymentCheck limit)', () => {
    // BillPaymentCheck.RefNumber cap is 11 in QB Desktop. Using the invoice
    // number (typically much longer) would silently truncate or reject.
    // Wire confirmation codes like "OTR6607568" (10 chars) fit; use those.
    expect(() => buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      refNumber: 'INV 178329594109', // 16 chars
    })).toThrow(/exceeds.*11-char.*limit/);
  });

  it('accepts refNumber of exactly 11 chars (boundary)', () => {
    // Boundary — belt-and-suspenders that the check is <=11, not <11.
    expect(() => buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      refNumber: '12345678901', // exactly 11
    })).not.toThrow();
  });

  it('omits refNumber when not provided', () => {
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      refNumber: undefined,
    });
    expect(out).not.toContain('<RefNumber>');
  });

  it('omits memo when not provided', () => {
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      memo: undefined,
    });
    expect(out).not.toContain('<Memo>');
  });

  it('emits IsToBePrinted true/false explicitly, omits when undefined', () => {
    // Convera wires are NOT printed checks, but QB companies may default to
    // "to be printed". Allowing explicit false lets callers defend against that.
    expect(buildBillPaymentCheckAddRq({ ...baseSinglePayment, isToBePrinted: true }))
      .toContain('<IsToBePrinted>true</IsToBePrinted>');
    expect(buildBillPaymentCheckAddRq({ ...baseSinglePayment, isToBePrinted: false }))
      .toContain('<IsToBePrinted>false</IsToBePrinted>');
    expect(buildBillPaymentCheckAddRq({ ...baseSinglePayment, isToBePrinted: undefined }))
      .not.toContain('<IsToBePrinted>');
  });

  it('throws when discountAmount is provided without discountAccountName', () => {
    // QB rejects the request (no account to book the discount to), but a
    // useful error at the builder is nicer than round-tripping to QB.
    expect(() => buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [{
        billTxnId: 'X',
        paymentAmount: 100,
        discountAmount: 10,
        // discountAccountName intentionally omitted
      }],
    })).toThrow(/discountAmount.*discountAccountName/);
  });

  it('omits DiscountClassRef when not provided', () => {
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      applications: [{
        billTxnId: 'X',
        paymentAmount: 100,
        discountAmount: 5,
        discountAccountName: 'Discounts Taken',
      }],
    });
    expect(out).toContain('<DiscountAmount>');
    expect(out).toContain('<DiscountAccountRef>');
    expect(out).not.toContain('<DiscountClassRef>');
  });

  it('emits requestID attribute when provided; omits when not', () => {
    expect(buildBillPaymentCheckAddRq({ ...baseSinglePayment, requestId: 'pay-42' }))
      .toContain('<BillPaymentCheckAddRq requestID="pay-42">');
    expect(buildBillPaymentCheckAddRq(baseSinglePayment))
      .not.toContain('requestID');
  });

  it('respects apAccountName override', () => {
    const out = buildBillPaymentCheckAddRq({
      ...baseSinglePayment,
      apAccountName: 'Other:AP Path',
    });
    expect(out).toContain('<FullName>Other:AP Path</FullName>');
    expect(out).not.toContain(`<FullName>${DEFAULT_AP_ACCOUNT}</FullName>`);
  });

  it('escapes XML special chars in payee, memo, and refNumber', () => {
    // Vendor names with '&' exist in prod (e.g. some Croatian companies).
    // RefNumber unlikely to contain specials but guard anyway.
    const out = buildBillPaymentCheckAddRq({
      payeeVendorName: 'A & B Ltd',
      txnDate: '2026-06-30',
      bankAccountName: WU_HOLDING,
      refNumber: 'a"b<c>d',
      memo: 'wire — INV <42> & fees',
      applications: [{ billTxnId: 'X', paymentAmount: 100 }],
    });
    expect(out).toContain('<FullName>A &amp; B Ltd</FullName>');
    expect(out).toContain('<RefNumber>a&quot;b&lt;c&gt;d</RefNumber>');
    expect(out).toContain('<Memo>wire — INV &lt;42&gt; &amp; fees</Memo>');
  });

  it('preserves Unicode (Croatian/Serbian diacritics) in payee and memo as-is', () => {
    const out = buildBillPaymentCheckAddRq({
      payeeVendorName: 'OBAI DRUŠTVO d.o.o.',
      txnDate: '2026-06-30',
      bankAccountName: WU_HOLDING,
      memo: 'Đđ Ž ž Č č Ć ć Š š — Marta Sušek',
      applications: [{ billTxnId: 'X', paymentAmount: 100 }],
    });
    expect(out).toContain('OBAI DRUŠTVO d.o.o.');
    expect(out).toContain('Đđ Ž ž Č č Ć ć Š š — Marta Sušek');
  });

  it('emits nothing when isToBePrinted is undefined AND no optional fields set (bare skeleton)', () => {
    // Sanity: just PayeeEntityRef, APAccountRef, TxnDate, BankAccountRef, one application.
    const out = buildBillPaymentCheckAddRq({
      payeeVendorName: 'Vendor',
      txnDate: '2026-06-30',
      bankAccountName: WU_HOLDING,
      applications: [{ billTxnId: 'X', paymentAmount: 100 }],
    });
    expect(out).not.toContain('<RefNumber>');
    expect(out).not.toContain('<Memo>');
    expect(out).not.toContain('<IsToBePrinted>');
    expect(out).not.toContain('<DiscountAmount>');
    expect(out).not.toContain('<SetCredit>');
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
