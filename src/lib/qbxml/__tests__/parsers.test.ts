import { describe, it, expect } from 'vitest';
import {
  parseBillAddRs,
  parseBillPaymentCheckAddRs,
  parseBillQueryRs,
  unwrapQbxmlResponses,
} from '../parsers';

// ─── Envelope splitting ─────────────────────────────────────────────────────

describe('unwrapQbxmlResponses', () => {
  it('extracts a single response element from a QBXML envelope', () => {
    const env = [
      '<?xml version="1.0" ?>',
      '<?qbxml version="13.0"?>',
      '<QBXML>',
      '  <QBXMLMsgsRs>',
      '    <BillQueryRs requestID="q-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">',
      '    </BillQueryRs>',
      '  </QBXMLMsgsRs>',
      '</QBXML>',
    ].join('\n');
    const parts = unwrapQbxmlResponses(env);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('<BillQueryRs');
    expect(parts[0]).toContain('</BillQueryRs>');
  });

  it('extracts multiple heterogeneous responses in order', () => {
    // The Web Connector can batch requests → responses come back in order.
    const env = [
      '<QBXML><QBXMLMsgsRs>',
      '<BillQueryRs statusCode="0"></BillQueryRs>',
      '<BillAddRs statusCode="0"></BillAddRs>',
      '<BillPaymentCheckAddRs statusCode="0"></BillPaymentCheckAddRs>',
      '</QBXMLMsgsRs></QBXML>',
    ].join('');
    const parts = unwrapQbxmlResponses(env);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('<BillQueryRs');
    expect(parts[1]).toContain('<BillAddRs');
    expect(parts[2]).toContain('<BillPaymentCheckAddRs');
  });

  it('returns [] when envelope contains no *Rs elements', () => {
    const env = '<QBXML><QBXMLMsgsRs></QBXMLMsgsRs></QBXML>';
    expect(unwrapQbxmlResponses(env)).toEqual([]);
  });

  it('falls back to whole doc when QBXMLMsgsRs is absent (bare-fragment error paths)', () => {
    // Some connectionError / getLastError paths return bare fragments.
    const bare = '<BillQueryRs statusCode="3000" statusSeverity="Error" statusMessage="X"></BillQueryRs>';
    const parts = unwrapQbxmlResponses(bare);
    expect(parts).toHaveLength(1);
  });
});

// ─── BillQueryRs ────────────────────────────────────────────────────────────

describe('parseBillQueryRs', () => {
  const buildBillRet = (opts: {
    txnId: string;
    editSeq: string;
    refNumber: string;
    withLinkedTxn?: boolean;
    withVendor?: string;
  }) => {
    const linked = opts.withLinkedTxn
      ? [
          '    <LinkedTxn>',
          '      <TxnID>PAYMENT-99999-9999999999</TxnID>',
          '      <TxnType>BillPaymentCheck</TxnType>',
          '      <TxnDate>2026-06-30</TxnDate>',
          '      <RefNumber>OTR6607568</RefNumber>',
          '      <LinkType>AMTTYPE</LinkType>',
          '      <Amount>1050.00</Amount>',
          '    </LinkedTxn>',
        ].join('\n')
      : '';
    const vendor = opts.withVendor
      ? [
          '    <VendorRef>',
          '      <ListID>80000042-1234567890</ListID>',
          `      <FullName>${opts.withVendor}</FullName>`,
          '    </VendorRef>',
        ].join('\n')
      : '';
    return [
      '  <BillRet>',
      `    <TxnID>${opts.txnId}</TxnID>`,
      '    <TimeCreated>2026-05-31T12:00:00-08:00</TimeCreated>',
      '    <TimeModified>2026-05-31T12:00:00-08:00</TimeModified>',
      `    <EditSequence>${opts.editSeq}</EditSequence>`,
      '    <TxnNumber>42</TxnNumber>',
      vendor,
      '    <TxnDate>2026-05-31</TxnDate>',
      '    <AmountDue>1050.00</AmountDue>',
      `    <RefNumber>${opts.refNumber}</RefNumber>`,
      '    <IsPaid>false</IsPaid>',
      linked,
      '  </BillRet>',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const wrap = (billRets: string, statusAttrs = 'statusCode="0" statusSeverity="Info" statusMessage="Status OK"') =>
    [
      '<QBXML><QBXMLMsgsRs>',
      `  <BillQueryRs requestID="q-1" ${statusAttrs}>`,
      billRets,
      '  </BillQueryRs>',
      '</QBXMLMsgsRs></QBXML>',
    ].join('\n');

  it('parses status attributes off the response element', () => {
    const env = wrap(buildBillRet({ txnId: 'T', editSeq: 'E', refNumber: 'R' }));
    const parsed = parseBillQueryRs(env);
    expect(parsed.status.statusCode).toBe('0');
    expect(parsed.status.statusSeverity).toBe('Info');
    expect(parsed.status.statusMessage).toBe('Status OK');
    expect(parsed.status.requestId).toBe('q-1');
  });

  it('extracts a single BillRet correctly', () => {
    const env = wrap(buildBillRet({
      txnId: '12006-1196864828',
      editSeq: '1234567890',
      refNumber: 'INV 178329594109',
    }));
    const parsed = parseBillQueryRs(env);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toEqual({
      txnId: '12006-1196864828',
      editSequence: '1234567890',
      refNumber: 'INV 178329594109',
    });
  });

  it('extracts multiple BillRet blocks in document order', () => {
    const env = wrap(
      [
        buildBillRet({ txnId: 'T-A', editSeq: 'E-A', refNumber: 'INV A' }),
        buildBillRet({ txnId: 'T-B', editSeq: 'E-B', refNumber: 'INV B' }),
        buildBillRet({ txnId: 'T-C', editSeq: 'E-C', refNumber: 'INV C' }),
      ].join('\n'),
    );
    const parsed = parseBillQueryRs(env);
    expect(parsed.results.map(r => r.refNumber)).toEqual(['INV A', 'INV B', 'INV C']);
    expect(parsed.results[0].txnId).toBe('T-A');
    expect(parsed.results[2].editSequence).toBe('E-C');
  });

  it('IGNORES nested LinkedTxn TxnID/RefNumber (the whole point of stripping)', () => {
    // This is the load-bearing test for the parser. A bill with linked-txn
    // history returns LinkedTxn blocks whose TxnID and RefNumber refer to
    // OTHER transactions (previous payments, credits). We must not surface
    // those as the bill's identity.
    const env = wrap(buildBillRet({
      txnId: 'BILL-HEADER-TXNID',
      editSeq: '9999999999',
      refNumber: 'INV HEADER',
      withLinkedTxn: true,
    }));
    const parsed = parseBillQueryRs(env);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].txnId).toBe('BILL-HEADER-TXNID');
    expect(parsed.results[0].refNumber).toBe('INV HEADER');
    // Sanity: the LinkedTxn's TxnID/RefNumber are NOT what we picked up.
    expect(parsed.results[0].txnId).not.toBe('PAYMENT-99999-9999999999');
    expect(parsed.results[0].refNumber).not.toBe('OTR6607568');
  });

  it('returns [] on zero-match success', () => {
    const env = wrap('', 'statusCode="0" statusSeverity="Info" statusMessage="Status OK"');
    const parsed = parseBillQueryRs(env);
    expect(parsed.status.statusCode).toBe('0');
    expect(parsed.results).toEqual([]);
  });

  it('returns [] on "no records found" status (statusCode=1)', () => {
    const env = wrap('', 'statusCode="1" statusSeverity="Warn" statusMessage="No records found"');
    const parsed = parseBillQueryRs(env);
    expect(parsed.status.statusCode).toBe('1');
    expect(parsed.status.statusSeverity).toBe('Warn');
    expect(parsed.results).toEqual([]);
  });

  it('returns [] on error status', () => {
    const env = wrap('', 'statusCode="3000" statusSeverity="Error" statusMessage="Invalid ref"');
    const parsed = parseBillQueryRs(env);
    expect(parsed.status.statusCode).toBe('3000');
    expect(parsed.status.statusSeverity).toBe('Error');
    expect(parsed.results).toEqual([]);
  });

  it('decodes XML entities in RefNumber and other text fields', () => {
    // Real invoices don't have &, but defensive.
    const env = wrap(
      [
        '  <BillRet>',
        '    <TxnID>T</TxnID>',
        '    <EditSequence>E</EditSequence>',
        '    <RefNumber>INV A &amp; B &lt;42&gt;</RefNumber>',
        '  </BillRet>',
      ].join('\n'),
    );
    const parsed = parseBillQueryRs(env);
    expect(parsed.results[0].refNumber).toBe('INV A & B <42>');
  });

  it('decodes XML entities in status attributes', () => {
    const env = wrap(
      '',
      'statusCode="3000" statusSeverity="Error" statusMessage="Ref &quot;X&quot; not found"',
    );
    const parsed = parseBillQueryRs(env);
    expect(parsed.status.statusMessage).toBe('Ref "X" not found');
  });

  it('skips BillRet blocks that are missing required leaf fields', () => {
    // Defensive: if QB ever returns a BillRet without TxnID (never
    // observed but future-proof), don't add a garbage entry.
    const env = wrap(
      [
        '  <BillRet>',
        '    <TxnID>T-GOOD</TxnID>',
        '    <EditSequence>E-GOOD</EditSequence>',
        '    <RefNumber>INV GOOD</RefNumber>',
        '  </BillRet>',
        '  <BillRet>',
        '    <EditSequence>E-BAD</EditSequence>',
        '    <RefNumber>INV BAD</RefNumber>',
        '  </BillRet>',
      ].join('\n'),
    );
    const parsed = parseBillQueryRs(env);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].refNumber).toBe('INV GOOD');
  });

  it('preserves Unicode in text fields (Croatian/Serbian diacritics)', () => {
    const env = wrap(
      [
        '  <BillRet>',
        '    <TxnID>T</TxnID>',
        '    <EditSequence>E</EditSequence>',
        '    <VendorRef><FullName>OBAI DRUŠTVO d.o.o.</FullName></VendorRef>',
        '    <RefNumber>INV Šehić</RefNumber>',
        '  </BillRet>',
      ].join('\n'),
    );
    const parsed = parseBillQueryRs(env);
    expect(parsed.results[0].refNumber).toBe('INV Šehić');
  });

  it('handles requestID as single-quoted attribute', () => {
    // QB always double-quotes, but the parser should not care.
    const env = wrap(
      buildBillRet({ txnId: 'T', editSeq: 'E', refNumber: 'R' }),
    ).replace('requestID="q-1"', "requestID='q-1'");
    const parsed = parseBillQueryRs(env);
    expect(parsed.status.requestId).toBe('q-1');
  });

  it('accepts a bare BillQueryRs fragment (no envelope)', () => {
    const bare = [
      '<BillQueryRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">',
      buildBillRet({ txnId: 'T', editSeq: 'E', refNumber: 'R' }),
      '</BillQueryRs>',
    ].join('\n');
    const parsed = parseBillQueryRs(bare);
    expect(parsed.status.statusCode).toBe('0');
    expect(parsed.results).toHaveLength(1);
  });
});

// ─── BillAddRs ──────────────────────────────────────────────────────────────

describe('parseBillAddRs', () => {
  it('parses a successful create with one BillRet', () => {
    const env = [
      '<QBXML><QBXMLMsgsRs>',
      '<BillAddRs requestID="add-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">',
      '<BillRet>',
      '<TxnID>12006-9999999999</TxnID>',
      '<EditSequence>7654321</EditSequence>',
      '<VendorRef><ListID>V</ListID><FullName>Bimosoft - Amar Pljevljak</FullName></VendorRef>',
      '<TxnDate>2026-05-31</TxnDate>',
      '<AmountDue>1050.00</AmountDue>',
      '<RefNumber>INV 178329594109</RefNumber>',
      '<IsPaid>false</IsPaid>',
      '</BillRet>',
      '</BillAddRs>',
      '</QBXMLMsgsRs></QBXML>',
    ].join('');
    const parsed = parseBillAddRs(env);
    expect(parsed.status.statusCode).toBe('0');
    expect(parsed.result).toEqual({
      txnId: '12006-9999999999',
      editSequence: '7654321',
      refNumber: 'INV 178329594109',
    });
  });

  it('returns result:null on error (statusCode != 0, no BillRet)', () => {
    // Realistic error: vendor doesn't exist. QB returns statusCode=3140 or similar.
    const env = [
      '<QBXML><QBXMLMsgsRs>',
      '<BillAddRs requestID="add-2" statusCode="3140" statusSeverity="Error" statusMessage="There is an invalid reference to QuickBooks Vendor \'Nonexistent\'.">',
      '</BillAddRs>',
      '</QBXMLMsgsRs></QBXML>',
    ].join('');
    const parsed = parseBillAddRs(env);
    expect(parsed.status.statusCode).toBe('3140');
    expect(parsed.status.statusSeverity).toBe('Error');
    expect(parsed.status.statusMessage).toContain("invalid reference");
    expect(parsed.result).toBeNull();
  });

  it('ignores LinkedTxn payload from server responses that echo linked history', () => {
    // Server-created bills can sometimes echo an initial payment link
    // (e.g. if the caller included LinkToTxnID). Belt-and-suspenders test.
    const env = [
      '<BillAddRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">',
      '<BillRet>',
      '<TxnID>HEADER-TXNID</TxnID>',
      '<EditSequence>HEADER-ES</EditSequence>',
      '<RefNumber>HEADER-REFNUM</RefNumber>',
      '<LinkedTxn>',
      '<TxnID>LINKED-TXNID</TxnID>',
      '<RefNumber>LINKED-REFNUM</RefNumber>',
      '</LinkedTxn>',
      '</BillRet>',
      '</BillAddRs>',
    ].join('');
    const parsed = parseBillAddRs(env);
    expect(parsed.result?.txnId).toBe('HEADER-TXNID');
    expect(parsed.result?.refNumber).toBe('HEADER-REFNUM');
  });
});

// ─── BillPaymentCheckAddRs ──────────────────────────────────────────────────

describe('parseBillPaymentCheckAddRs', () => {
  it('parses a successful payment creation', () => {
    const env = [
      '<BillPaymentCheckAddRs requestID="pay-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">',
      '<BillPaymentCheckRet>',
      '<TxnID>PMT-12006-1111111111</TxnID>',
      '<EditSequence>ES-PMT-1</EditSequence>',
      '<PayeeEntityRef><ListID>V</ListID><FullName>Bimosoft - Amar Pljevljak</FullName></PayeeEntityRef>',
      '<APAccountRef><FullName>Accounts Payable</FullName></APAccountRef>',
      '<TxnDate>2026-06-30</TxnDate>',
      '<BankAccountRef><FullName>BANK/CASH:Western Union Holding</FullName></BankAccountRef>',
      '<RefNumber>OTR6607568</RefNumber>',
      '<Amount>1050.00</Amount>',
      '<AppliedToTxnRet>',
      '<TxnID>BILL-INNER-TXNID-1</TxnID>',
      '<PaymentAmount>1050.00</PaymentAmount>',
      '<RefNumber>INV 178329594109</RefNumber>',
      '</AppliedToTxnRet>',
      '</BillPaymentCheckRet>',
      '</BillPaymentCheckAddRs>',
    ].join('');
    const parsed = parseBillPaymentCheckAddRs(env);
    expect(parsed.status.statusCode).toBe('0');
    expect(parsed.result).toEqual({
      txnId: 'PMT-12006-1111111111',
      editSequence: 'ES-PMT-1',
      refNumber: 'OTR6607568',
    });
  });

  it('IGNORES nested AppliedToTxnRet TxnID / RefNumber', () => {
    // Same shape as the BillRet/LinkedTxn test but with the corresponding
    // BillPaymentCheck sub-block. The payment's identity is its OWN TxnID,
    // not any of the bill TxnIDs it applies to.
    const env = [
      '<BillPaymentCheckAddRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">',
      '<BillPaymentCheckRet>',
      '<TxnID>PAYMENT-HEADER-TXNID</TxnID>',
      '<EditSequence>PAYMENT-ES</EditSequence>',
      '<RefNumber>OTR-PAY</RefNumber>',
      '<AppliedToTxnRet>',
      '<TxnID>BILL-A-TXNID</TxnID>',
      '<PaymentAmount>500.00</PaymentAmount>',
      '<RefNumber>INV A</RefNumber>',
      '</AppliedToTxnRet>',
      '<AppliedToTxnRet>',
      '<TxnID>BILL-B-TXNID</TxnID>',
      '<PaymentAmount>500.00</PaymentAmount>',
      '<RefNumber>INV B</RefNumber>',
      '</AppliedToTxnRet>',
      '</BillPaymentCheckRet>',
      '</BillPaymentCheckAddRs>',
    ].join('');
    const parsed = parseBillPaymentCheckAddRs(env);
    expect(parsed.result?.txnId).toBe('PAYMENT-HEADER-TXNID');
    expect(parsed.result?.refNumber).toBe('OTR-PAY');
  });

  it('omits refNumber when the payment was submitted without one', () => {
    // BillPaymentCheck.RefNumber is optional on the request → optional on the response.
    const env = [
      '<BillPaymentCheckAddRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">',
      '<BillPaymentCheckRet>',
      '<TxnID>PMT</TxnID>',
      '<EditSequence>ES</EditSequence>',
      '<Amount>100.00</Amount>',
      '</BillPaymentCheckRet>',
      '</BillPaymentCheckAddRs>',
    ].join('');
    const parsed = parseBillPaymentCheckAddRs(env);
    expect(parsed.result).toEqual({ txnId: 'PMT', editSequence: 'ES' });
    expect(parsed.result).not.toHaveProperty('refNumber');
  });

  it('returns result:null when the response element is missing', () => {
    const parsed = parseBillPaymentCheckAddRs('<QBXML><QBXMLMsgsRs></QBXMLMsgsRs></QBXML>');
    expect(parsed.result).toBeNull();
    expect(parsed.status.statusMessage).toContain('not found');
  });

  it('returns result:null on error status', () => {
    const env = [
      '<BillPaymentCheckAddRs statusCode="3200" statusSeverity="Error" statusMessage="The specified transaction ID is invalid.">',
      '</BillPaymentCheckAddRs>',
    ].join('');
    const parsed = parseBillPaymentCheckAddRs(env);
    expect(parsed.status.statusCode).toBe('3200');
    expect(parsed.result).toBeNull();
  });
});
