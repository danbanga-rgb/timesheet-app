import { describe, it, expect } from 'vitest';
import {
  computeMatchProvenance,
  memoNamesMatchedInvoice,
  type ProvenanceInput,
} from './matchProvenance';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Reverse lookup: 3 invoices with known qb_bill_txn_ids.
const invoiceIdByBillTxnId = new Map<string, number>([
  ['41838-1787006351', 118],   // Mek INV-000047
  ['41294-1784756815', 175],   // Mek INV-000048
  ['41835-1787006349', 110],   // Rumiya INV 10
]);

function inputOf(overrides: Partial<ProvenanceInput> = {}): ProvenanceInput {
  return {
    eventResolvedBillTxnId: null,
    matchedInvoiceIds: [],
    memoNamesMatchedInvoice: false,
    targetQbTxnKind: 'bill_pmt',
    invoiceIdByBillTxnId,
    ...overrides,
  };
}

// ─── computeMatchProvenance ──────────────────────────────────────────────────

describe('computeMatchProvenance', () => {
  it('returns exact-txn when event resolved bill matches an invoice qb_bill_txn_id', () => {
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: '41838-1787006351',
      matchedInvoiceIds: [999],           // matcher picked wrong invoice
      memoNamesMatchedInvoice: false,
    }));
    expect(r.provenance).toBe('exact-txn');
    expect(r.authoritativeInvoiceId).toBe(118);
  });

  it('exact-txn overrides even when memo names a different matched invoice', () => {
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: '41294-1784756815',
      matchedInvoiceIds: [999],
      memoNamesMatchedInvoice: true,
    }));
    expect(r.provenance).toBe('exact-txn');
    expect(r.authoritativeInvoiceId).toBe(175);
  });

  it('returns empty when targetQbTxnKind=check regardless of matches', () => {
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: null,
      matchedInvoiceIds: [118],
      memoNamesMatchedInvoice: true,
      targetQbTxnKind: 'check',
    }));
    expect(r.provenance).toBe('empty');
    expect(r.authoritativeInvoiceId).toBeUndefined();
  });

  it('returns empty when targetQbTxnKind=ignore', () => {
    const r = computeMatchProvenance(inputOf({
      matchedInvoiceIds: [118],
      memoNamesMatchedInvoice: true,
      targetQbTxnKind: 'ignore',
    }));
    expect(r.provenance).toBe('empty');
  });

  it('returns exact-ref when memo names matched invoice and no exact-txn available', () => {
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: null,
      matchedInvoiceIds: [118],
      memoNamesMatchedInvoice: true,
    }));
    expect(r.provenance).toBe('exact-ref');
    expect(r.authoritativeInvoiceId).toBeUndefined();
  });

  it('returns fuzzy when matched invoice(s) exist but memo does not name them', () => {
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: null,
      matchedInvoiceIds: [118],
      memoNamesMatchedInvoice: false,
    }));
    expect(r.provenance).toBe('fuzzy');
  });

  it('returns empty when no matches', () => {
    const r = computeMatchProvenance(inputOf({
      matchedInvoiceIds: [],
      memoNamesMatchedInvoice: false,
    }));
    expect(r.provenance).toBe('empty');
  });

  it('falls through to fuzzy when event has resolved bill but no invoice claims it', () => {
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: 'BILL-NOT-IN-OUR-INVOICES',
      matchedInvoiceIds: [999],
      memoNamesMatchedInvoice: false,
    }));
    expect(r.provenance).toBe('fuzzy');
  });

  it('falls through to empty when event has resolved bill but no invoice claims it and no matches', () => {
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: 'BILL-NOT-IN-OUR-INVOICES',
      matchedInvoiceIds: [],
      memoNamesMatchedInvoice: false,
    }));
    expect(r.provenance).toBe('empty');
  });

  it('returns created-pay for G7b orphan: resolved bill + no invoice + bill_add_and_pmt kind', () => {
    // TechAntz-style: we created the bill via bill_add. Event now has
    // resolved_bill_txn_id (from drain handler) but no invoice claims it,
    // and mapping = create+pay. Surfaces as created-pay, not empty.
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: '41873-1787609600',   // not in invoiceIdByBillTxnId
      matchedInvoiceIds: [],
      memoNamesMatchedInvoice: false,
      targetQbTxnKind: 'bill_add_and_pmt',
    }));
    expect(r.provenance).toBe('created-pay');
    expect(r.authoritativeInvoiceId).toBeUndefined();
  });

  it('does NOT return created-pay for bill_pmt kind — only bill_add_and_pmt orphan case', () => {
    // pay_existing_bill with resolved bill but no invoice-side link stays
    // empty (bill created outside our system).
    const r = computeMatchProvenance(inputOf({
      eventResolvedBillTxnId: '41873-1787609600',
      matchedInvoiceIds: [],
      memoNamesMatchedInvoice: false,
      targetQbTxnKind: 'bill_pmt',
    }));
    expect(r.provenance).toBe('empty');
  });
});

// ─── memoNamesMatchedInvoice ─────────────────────────────────────────────────
// Uses normalizeRef from src/lib/intuit/reconcile.ts: uppercase, strip leading
// INV[#space-]* prefix. So "Inv# 11", "INV 11", "11" all → "11".

describe('memoNamesMatchedInvoice', () => {
  it('returns true when parsed ref (bare number) matches invoice_number with INV prefix', () => {
    const r = memoNamesMatchedInvoice(
      ['11'],
      [{ invoiceNumber: 'INV 11' }],
    );
    expect(r).toBe(true);
  });

  it('returns true when parsed ref carries INV prefix and invoice number does too', () => {
    const r = memoNamesMatchedInvoice(
      ['INV-000047'],
      [{ invoiceNumber: 'INV-000047' }],
    );
    expect(r).toBe(true);
  });

  it('returns true for Hover-style stacked "INV INV-000046"', () => {
    const r = memoNamesMatchedInvoice(
      ['INV-000046'],
      [{ invoiceNumber: 'INV-000046' }],
    );
    expect(r).toBe(true);
  });

  it('returns false when memo names a different invoice number', () => {
    const r = memoNamesMatchedInvoice(
      ['12'],
      [{ invoiceNumber: 'INV 11' }],
    );
    expect(r).toBe(false);
  });

  it('returns false when matched invoices have null invoice_number', () => {
    const r = memoNamesMatchedInvoice(
      ['11'],
      [{ invoiceNumber: null }],
    );
    expect(r).toBe(false);
  });

  it('returns false when memoRefs is empty', () => {
    const r = memoNamesMatchedInvoice([], [{ invoiceNumber: 'INV 11' }]);
    expect(r).toBe(false);
  });

  it('returns false when matched invoices is empty', () => {
    const r = memoNamesMatchedInvoice(['11'], []);
    expect(r).toBe(false);
  });

  it('returns true if ANY matched invoice matches ANY ref (multi-invoice memo)', () => {
    const r = memoNamesMatchedInvoice(
      ['03', '04'],
      [{ invoiceNumber: 'INV 03' }, { invoiceNumber: 'INV 04' }],
    );
    expect(r).toBe(true);
  });

  it('returns true if at least one matched invoice matches (partial subset hit still counts)', () => {
    const r = memoNamesMatchedInvoice(
      ['03', '99'],
      [{ invoiceNumber: 'INV 03' }, { invoiceNumber: 'INV 04' }],
    );
    expect(r).toBe(true);
  });

  it('works for Sivakumar-style PT- refs (letters + numbers)', () => {
    const r = memoNamesMatchedInvoice(
      ['PT-10631'],
      [{ invoiceNumber: 'INV PT-10631' }],
    );
    expect(r).toBe(true);
  });
});
