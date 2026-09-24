import { describe, it, expect } from 'vitest';
import type { QbOpenBillRow } from '../../qbStateSync/types';
import {
  derivePushedRowDisplay,
  deriveSyntheticPushedRowDisplay,
  formatActionLabel,
  formatProvenanceBadge,
} from '../pushedRowDerivation';

const bill = (over: Partial<QbOpenBillRow> = {}): QbOpenBillRow => ({
  vendorListId: 'V1',
  vendorName: 'Vendor',
  refNumber: 'INV-1',
  txnId: 'TXN-1',
  txnDate: '2026-09-01',
  dueDate: null,
  amount: 100,
  openAmount: 0,
  isPaid: true,
  queriedAt: '2026-09-24T10:00:00Z',
  ...over,
});

describe('derivePushedRowDisplay', () => {
  it('resolves refLabel from bill map', () => {
    const d = derivePushedRowDisplay(
      { resolvedAction: 'pay_existing_bill', resolvedBillTxnId: 'TXN-1', matchProvenance: 'exact-txn', source: 'convera' },
      new Map([['TXN-1', bill({ refNumber: 'INV 58' })]]),
    );
    expect(d.resolvedRefLabel).toBe('INV 58');
    expect(d.resolvedAction).toBe('pay_existing_bill');
    expect(d.matchProvenance).toBe('exact-txn');
    expect(d.isG75Source).toBe(false);
  });

  it('sets isG75Source true when source is invoice_g75', () => {
    const d = derivePushedRowDisplay(
      { resolvedAction: 'create_bill_then_pay', resolvedBillTxnId: null, matchProvenance: 'exact-ref', source: 'invoice_g75' },
      new Map(),
    );
    expect(d.isG75Source).toBe(true);
  });

  it('leaves resolvedRefLabel null when bill txn not in map', () => {
    const d = derivePushedRowDisplay(
      { resolvedAction: 'pay_existing_bill', resolvedBillTxnId: 'MISSING', matchProvenance: 'fuzzy', source: 'intuit' },
      new Map(),
    );
    expect(d.resolvedRefLabel).toBeNull();
  });
});

describe('deriveSyntheticPushedRowDisplay', () => {
  it('g75 → created bill wording (isG75Source=true)', () => {
    const d = deriveSyntheticPushedRowDisplay('g75', 'INV 500');
    expect(d.isG75Source).toBe(true);
    expect(d.resolvedAction).toBe('create_bill_then_pay');
    expect(d.matchProvenance).toBe('exact-ref');
    expect(d.resolvedRefLabel).toBe('INV 500');
    expect(formatActionLabel(d)).toBe('created bill: INV 500');
  });

  it('g76 → created bill + paid wording (isG75Source=false)', () => {
    const d = deriveSyntheticPushedRowDisplay('g76', 'INV 8/1/1');
    expect(d.isG75Source).toBe(false);
    expect(formatActionLabel(d)).toBe('created bill + paid: INV 8/1/1');
  });

  it('empty invoice number → null ref label', () => {
    const d = deriveSyntheticPushedRowDisplay('g75', null);
    expect(d.resolvedRefLabel).toBeNull();
    expect(formatActionLabel(d)).toBe('created bill');
  });
});

describe('formatActionLabel', () => {
  it('already_done → paid: <ref>', () => {
    expect(formatActionLabel({ resolvedAction: 'already_done', resolvedRefLabel: 'INV 58', isG75Source: false, matchProvenance: 'exact-txn' })).toBe('paid: INV 58');
  });

  it('pay_existing_bill → paid: <ref>', () => {
    expect(formatActionLabel({ resolvedAction: 'pay_existing_bill', resolvedRefLabel: 'INV 12', isG75Source: false, matchProvenance: 'exact-ref' })).toBe('paid: INV 12');
  });

  it('create_bill_then_pay non-G75 → created bill + paid', () => {
    expect(formatActionLabel({ resolvedAction: 'create_bill_then_pay', resolvedRefLabel: 'INV 3-2026', isG75Source: false, matchProvenance: 'exact-ref' })).toBe('created bill + paid: INV 3-2026');
  });

  it('check → wrote check', () => {
    expect(formatActionLabel({ resolvedAction: 'check', resolvedRefLabel: null, isG75Source: false, matchProvenance: null })).toBe('wrote check');
  });

  it('null action → empty string', () => {
    expect(formatActionLabel({ resolvedAction: null, resolvedRefLabel: null, isG75Source: false, matchProvenance: null })).toBe('');
  });
});

describe('formatProvenanceBadge', () => {
  it('exact-txn: emerald palette + lock emoji', () => {
    const b = formatProvenanceBadge('exact-txn');
    expect(b.text).toBe('🔒 exact-txn');
    expect(b.bg).toBe('bg-emerald-100');
  });

  it('exact-ref: teal palette + check emoji', () => {
    const b = formatProvenanceBadge('exact-ref');
    expect(b.text).toBe('✓ exact-ref');
    expect(b.bg).toBe('bg-teal-100');
  });

  it('created-pay: violet', () => {
    expect(formatProvenanceBadge('created-pay').bg).toBe('bg-violet-100');
  });

  it('fuzzy: amber', () => {
    expect(formatProvenanceBadge('fuzzy').bg).toBe('bg-amber-100');
  });

  it('empty and null both render as — empty', () => {
    expect(formatProvenanceBadge('empty').text).toBe('— empty');
    expect(formatProvenanceBadge(null).text).toBe('— empty');
  });
});
