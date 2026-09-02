import { describe, it, expect } from 'vitest';
import { buildConveraShadowRow, type ConveraShadowInput } from '../converaShadow';

const baseInput: ConveraShadowInput = {
  converaTransactionId: 42,
  confirmationNumber: 'CNF12345',
  lineItem: 1,
  txnDate: '2026-09-02',
  amount: 3520,
  beneficiaryName: 'Fat Struct d.o.o',
  ref1: 'INV 1-1-1',
  matchedInvoiceIds: [250],
  matchState: 'matched',
  matcherIgnore: false,
};

describe('buildConveraShadowRow', () => {
  it('maps input to qb_ingest_events row shape with source=convera', () => {
    const out = buildConveraShadowRow(baseInput);
    expect(out.source).toBe('convera');
    expect(out.source_ref).toBe('CNF12345::1');
    expect(out.txn_date).toBe('2026-09-02');
    expect(out.amount).toBe(3520);
    expect(out.counterparty_raw).toBe('Fat Struct d.o.o');
    expect(out.memo).toBe('INV 1-1-1');
    expect(out.matched_invoice_ids).toEqual([250]);
    expect(out.status).toBe('pending');
  });

  it('carries convera-specific fields in raw_data for cross-ref', () => {
    const out = buildConveraShadowRow(baseInput);
    expect(out.raw_data).toEqual({
      convera_transaction_id: 42,
      confirmation_number: 'CNF12345',
      line_item: 1,
      ref1: 'INV 1-1-1',
      match_state: 'matched',
    });
  });

  it('flips status to ignored when matcherIgnore is true (pre-cutoff legacy)', () => {
    const out = buildConveraShadowRow({ ...baseInput, matcherIgnore: true });
    expect(out.status).toBe('ignored');
  });

  it('composes source_ref from confirmation number + line item so multi-line wires are distinct', () => {
    const line1 = buildConveraShadowRow(baseInput);
    const line2 = buildConveraShadowRow({ ...baseInput, lineItem: 2 });
    expect(line1.source_ref).not.toBe(line2.source_ref);
    expect(line2.source_ref).toBe('CNF12345::2');
  });

  it('memo is null when ref1 is empty or missing', () => {
    expect(buildConveraShadowRow({ ...baseInput, ref1: '' }).memo).toBeNull();
    expect(buildConveraShadowRow({ ...baseInput, ref1: null }).memo).toBeNull();
  });

  it('unmatched wire yields empty matched_invoice_ids with pending status', () => {
    const out = buildConveraShadowRow({ ...baseInput, matchedInvoiceIds: [], matchState: 'unreviewed' });
    expect(out.matched_invoice_ids).toEqual([]);
    expect(out.status).toBe('pending');
    expect((out.raw_data as { match_state: string }).match_state).toBe('unreviewed');
  });

  it('umbrella wire (multi-invoice match) preserves all invoice ids', () => {
    const out = buildConveraShadowRow({ ...baseInput, matchedInvoiceIds: [250, 251, 252] });
    expect(out.matched_invoice_ids).toEqual([250, 251, 252]);
  });
});
