import { describe, it, expect } from 'vitest';
import { PAYLOAD_REQUIRED_KEYS, validatePayload } from '../job-payloads';

describe('PAYLOAD_REQUIRED_KEYS', () => {
  it('captures the keys the edge fn persist step depends on today', () => {
    // Lock in current state. If we intentionally add/remove a required key, this
    // test fails and forces us to review both sides (edge fn persist AND every
    // enqueue script that writes this payload kind).
    // bill_query is [] because it has three mutually-exclusive modes (txnIds, refNumbers,
    // iterator). buildBillQueryRq is the authoritative mode-contract validator; validatePayload
    // can't express "any of these three" so we defer to the builder.
    expect(PAYLOAD_REQUIRED_KEYS.bill_query).toEqual([]);
    expect(PAYLOAD_REQUIRED_KEYS.bill_add).toEqual(['vendorName', 'refNumber']);
    // bill_pmt_add uses { required, oneOf } shape as of 2026-08-21 to support both
    // Convera path (sourceConveraTxnId + refNumber wire code) and Intuit path
    // (sourceIngestEventId, blank RefNumber per historic convention).
    expect(PAYLOAD_REQUIRED_KEYS.bill_pmt_add).toEqual({
      required: ['payeeVendorName', 'applications'],
      oneOf: [['refNumber', 'sourceConveraTxnId'], ['sourceIngestEventId']],
    });
    expect(PAYLOAD_REQUIRED_KEYS.account_query).toEqual([]);
    expect(PAYLOAD_REQUIRED_KEYS.vendor_query).toEqual([]);
  });
});

describe('validatePayload', () => {
  it('passes a canonical bill_pmt_add payload that matches what qb-batch-enqueue-payments.cjs writes', () => {
    // This is the shape enqueue-payments.cjs constructs (as of 2026-08-14 after
    // sourceConveraTxnId was added). If enqueue drifts, this test still passes
    // (it tests the schema, not the script). Runtime check on the actual job's
    // payload in the edge fn is the counterpart that catches drift live.
    const payload = {
      payeeVendorName: 'Native Team Ltd. - Marta Susek',
      bankAccountName: 'BANK/CASH:8220 - Key Point Checking',
      txnDate: '2026-08-13',
      refNumber: 'OTR6638533',
      sourceConveraTxnId: 933,
      memo: 'Convera wire OTR6638533 - 6 invoices - Teal Crossroads',
      applications: [{ billTxnId: '412A0-1784756817', paymentAmount: 38050 }],
    };
    const result = validatePayload('bill_pmt_add', payload);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('detects the 2026-08-14 regression class: BOTH source refs missing', () => {
    const brokenPayload = {
      payeeVendorName: 'x',
      bankAccountName: 'y',
      txnDate: '2026-08-13',
      refNumber: 'OTR-Z',
      // sourceConveraTxnId AND sourceIngestEventId both missing — the bug
      memo: 'z',
      applications: [{ billTxnId: 'B', paymentAmount: 1 }],
    };
    const result = validatePayload('bill_pmt_add', brokenPayload);
    expect(result.ok).toBe(false);
    expect(result.oneOfFailure).toMatch(/sourceConveraTxnId.*sourceIngestEventId|sourceIngestEventId.*sourceConveraTxnId/);
  });

  it('accepts the Intuit path (sourceIngestEventId only)', () => {
    const intuitPayload = {
      payeeVendorName: 'Flawless APPS LLC',
      bankAccountName: 'BANK/CASH:8220 - Key Point Checking',
      txnDate: '2026-08-03',
      refNumber: 'INTUIT-89',
      sourceIngestEventId: 89,
      memo: 'Intuit BillPay - INV 11',
      applications: [{ billTxnId: '41282-1784756812', paymentAmount: 9625 }],
    };
    expect(validatePayload('bill_pmt_add', intuitPayload).ok).toBe(true);
  });

  it('also detects payload key rename (all required + no source ref)', () => {
    const renamedPayload = {
      // simulates prior version that used `confirmationNumber` instead of the
      // correct keys — persist would silently no-op without this check
      confirmationNumber: 'OTR-Z',
    };
    const result = validatePayload('bill_pmt_add', renamedPayload);
    expect(result.ok).toBe(false);
    // required missing (payeeVendorName + applications). refNumber is no longer
    // in `required` — it's in the Convera arm of `oneOf` — so its absence is
    // signaled through oneOfFailure, not `missing`. validatePayload short-circuits
    // on `missing`; oneOfFailure only surfaces once `required` is satisfied.
    expect(result.missing.sort()).toEqual(['applications', 'payeeVendorName']);
  });

  it('rejects null/undefined payloads for kinds with required keys', () => {
    expect(validatePayload('bill_pmt_add', null).ok).toBe(false);
    expect(validatePayload('bill_pmt_add', undefined).ok).toBe(false);
    expect(validatePayload('bill_add', {}).missing).toEqual(['vendorName', 'refNumber']);
  });

  it('passes null/undefined payloads for kinds with no required keys', () => {
    expect(validatePayload('account_query', null).ok).toBe(true);
    expect(validatePayload('vendor_query', {}).ok).toBe(true);
  });

  it('treats a key with value null as missing (not just absent)', () => {
    const payload = { vendorName: null, refNumber: 'INV 1' };
    const result = validatePayload('bill_add', payload);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['vendorName']);
  });
});
