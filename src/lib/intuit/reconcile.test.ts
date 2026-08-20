import { describe, it, expect } from 'vitest';
import {
  normalizeRef,
  extractRefsFromMemo,
  scoreBillMatch,
  findSettlingPayment,
  reconcileEvent,
  reconcileBatch,
  type MirrorBill,
  type MirrorPayment,
  type ReconcilableEvent,
  type ReconcileContext,
} from './reconcile';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VENDOR = 'V-HOVER';
const OTHER_VENDOR = 'V-OTHER';

const bill = (o: Partial<MirrorBill> = {}): MirrorBill => ({
  txnId: 'B1',
  vendorListId: VENDOR,
  refNumber: 'INV 12',
  amount: 9625,
  isPaid: false,
  txnDate: '2026-07-15',
  ...o,
});

const payment = (o: Partial<MirrorPayment> = {}): MirrorPayment => ({
  txnId: 'P1',
  vendorListId: VENDOR,
  amount: 9625,
  txnDate: '2026-07-20',
  appliedToBills: [],
  ...o,
});

const event = (o: Partial<ReconcilableEvent> = {}): ReconcilableEvent => ({
  id: 1,
  counterpartyRaw: 'Hover cloud tech LLC',
  memo: 'Inv# 12',
  amount: 9625,
  txnDate: '2026-07-20',
  counterpartyQbVendorListId: VENDOR,
  targetQbTxnKind: 'bill_pmt',
  matchedInvoiceIds: [],
  status: 'pending',
  ...o,
});

const ctxWith = (bills: MirrorBill[] = [], payments: MirrorPayment[] = []): ReconcileContext => ({
  billsByVendor: new Map([[VENDOR, bills]]),
  paymentsByVendor: new Map([[VENDOR, payments]]),
});

// ─── normalizeRef ────────────────────────────────────────────────────────────

describe('normalizeRef', () => {
  it('uppercases + strips INV# prefix', () => {
    expect(normalizeRef('Inv# 12')).toBe('12');
    expect(normalizeRef('INV 12')).toBe('12');
    expect(normalizeRef('INV#12')).toBe('12');
    expect(normalizeRef('inv#12')).toBe('12');
    expect(normalizeRef('#12')).toBe('12');
    expect(normalizeRef('12')).toBe('12');
  });
  it('preserves alphanumeric refs with slashes/dashes', () => {
    expect(normalizeRef('INV 226/1/1')).toBe('226/1/1');
    expect(normalizeRef('Inv# 03/26')).toBe('03/26');
  });
  it('null/empty → empty string', () => {
    expect(normalizeRef(null)).toBe('');
    expect(normalizeRef('')).toBe('');
  });
});

describe('extractRefsFromMemo', () => {
  it('single ref', () => {
    expect(extractRefsFromMemo('Inv# 12')).toEqual(['12']);
  });
  it('multiple refs separated by commas', () => {
    const refs = extractRefsFromMemo('Inv# 03, Inv# 04');
    expect(refs.sort()).toEqual(['03', '04']);
  });
  it('mixed casing + formats', () => {
    const refs = extractRefsFromMemo('INV#12 INV 13');
    expect(refs.sort()).toEqual(['12', '13']);
  });
  it('handles memo with no refs', () => {
    expect(extractRefsFromMemo('some other text')).toEqual([]);
    expect(extractRefsFromMemo(null)).toEqual([]);
  });
});

// ─── scoreBillMatch ──────────────────────────────────────────────────────────

describe('scoreBillMatch', () => {
  it('exact ref + exact amount = highest score', () => {
    const s = scoreBillMatch(['12'], 9625, '2026-07-20', bill());
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(140);
  });
  it('ref match but amount off (>1% but <5%) = still matches, lower than exact', () => {
    const exact = scoreBillMatch(['12'], 9625, '2026-07-20', bill({ amount: 9625 }))!;
    const off = scoreBillMatch(['12'], 9800, '2026-07-20', bill({ amount: 9625 }))!;
    expect(off).not.toBeNull();
    expect(off).toBeLessThan(exact);
  });
  it('no ref match, amount within 5% = matches', () => {
    const s = scoreBillMatch(['999'], 9700, '2026-07-20', bill({ amount: 9625 }));
    expect(s).not.toBeNull();
  });
  it('no ref match, amount off by > 5% = no match', () => {
    const s = scoreBillMatch(['999'], 5000, '2026-07-20', bill({ amount: 9625 }));
    expect(s).toBeNull();
  });
  it('date proximity boosts score', () => {
    const near = scoreBillMatch(['12'], 9625, '2026-07-15', bill({ txnDate: '2026-07-15' }));
    const far = scoreBillMatch(['12'], 9625, '2026-07-15', bill({ txnDate: '2025-07-15' }));
    expect(near!).toBeGreaterThan(far!);
  });
});

// ─── findSettlingPayment ─────────────────────────────────────────────────────

describe('findSettlingPayment', () => {
  it('returns payment TxnID when appliedToBills contains bill', () => {
    const b = bill({ txnId: 'B-99', isPaid: true });
    const p = payment({ txnId: 'P-77', appliedToBills: [{ billTxnId: 'B-99', amount: 9625 }] });
    const r = findSettlingPayment(b, [p]);
    expect(r).toEqual({ paymentTxnId: 'P-77', alreadySettled: true });
  });
  it('returns alreadySettled=true without TxnID when bill.isPaid but no explicit link', () => {
    const b = bill({ isPaid: true });
    const r = findSettlingPayment(b, [payment({ appliedToBills: [] })]);
    expect(r).toEqual({ alreadySettled: true });
  });
  it('returns alreadySettled=false when bill unpaid + no link', () => {
    const r = findSettlingPayment(bill({ isPaid: false }), []);
    expect(r).toEqual({ alreadySettled: false });
  });
});

// ─── reconcileEvent (per-event outcomes) ─────────────────────────────────────

describe('reconcileEvent', () => {
  it("action='held' when event has no QB vendor mapped", () => {
    const e = event({ counterpartyQbVendorListId: null });
    const r = reconcileEvent(e, ctxWith(), new Set());
    expect(r.action).toBe('held');
    expect(r.reason).toContain('no QB vendor mapped');
  });

  it("action='held' when kind=ignore", () => {
    const e = event({ targetQbTxnKind: 'ignore' });
    const r = reconcileEvent(e, ctxWith(), new Set());
    expect(r.action).toBe('held');
  });

  it("action='check' passes through without mirror lookup", () => {
    const e = event({ targetQbTxnKind: 'check' });
    const r = reconcileEvent(e, ctxWith(), new Set());
    expect(r.action).toBe('check');
    expect(r.billTxnId).toBeUndefined();
  });

  it("action='held' when vendor has no bills AND no payments in mirror (not synced)", () => {
    const e = event();
    const r = reconcileEvent(e, ctxWith([], []), new Set());
    expect(r.action).toBe('held');
    expect(r.reason).toContain('not synced');
  });

  it("action='pay_existing_bill' when bill matches + unpaid", () => {
    const b = bill({ isPaid: false });
    const r = reconcileEvent(event(), ctxWith([b]), new Set());
    expect(r.action).toBe('pay_existing_bill');
    expect(r.billTxnId).toBe(b.txnId);
  });

  it("action='already_done' when bill matches + explicit payment link", () => {
    const b = bill({ txnId: 'B-A', isPaid: true });
    const p = payment({ txnId: 'P-A', appliedToBills: [{ billTxnId: 'B-A', amount: 9625 }] });
    const r = reconcileEvent(event(), ctxWith([b], [p]), new Set());
    expect(r.action).toBe('already_done');
    expect(r.billTxnId).toBe('B-A');
    expect(r.paymentTxnId).toBe('P-A');
  });

  it("action='already_done' when bill isPaid=true but no explicit payment link", () => {
    const b = bill({ isPaid: true });
    const r = reconcileEvent(event(), ctxWith([b], [payment()]), new Set());
    expect(r.action).toBe('already_done');
    expect(r.billTxnId).toBe(b.txnId);
    expect(r.paymentTxnId).toBeUndefined();
  });

  it("action='create_bill_then_pay' when no bill matches", () => {
    // Bill has vendor rows but ref + amount both different
    const b = bill({ refNumber: 'INV 999', amount: 100 });
    const r = reconcileEvent(event({ memo: 'Inv# 12', amount: 9625 }), ctxWith([b]), new Set());
    expect(r.action).toBe('create_bill_then_pay');
  });

  it("2026-08-20: amount-only match (no ref match) does NOT produce already_done — falls to create_bill_then_pay", () => {
    // Regression: Event 84 (Inv# 05, $8400) previously loose-matched to
    // 402BC (Inv# 06, $8400) via amount-only. Now such matches are refused.
    const b = bill({ refNumber: 'INV 06', amount: 8400, isPaid: true });
    const r = reconcileEvent(
      event({ memo: 'Inv# 05', amount: 8400 }),  // ref='05' != bill's '06'
      ctxWith([b], [payment({ appliedToBills: [{ billTxnId: 'B1', amount: 8400 }] })]),
      new Set(),
    );
    expect(r.action).toBe('create_bill_then_pay');   // NOT already_done
    expect(r.billTxnId).toBeUndefined();
  });

  it("skips a bill already claimed by another event in same batch", () => {
    const b = bill({ txnId: 'B-shared', refNumber: 'INV 12', amount: 9625 });
    const claimed = new Set(['B-shared']);
    const r = reconcileEvent(event(), ctxWith([b]), claimed);
    // Only bill available is claimed → falls to create_bill_then_pay
    expect(r.action).toBe('create_bill_then_pay');
  });

  it("normalization: 'Inv# 12' event memo matches 'INV 12' bill refNumber", () => {
    const b = bill({ refNumber: 'INV 12' });
    const r = reconcileEvent(event({ memo: 'Inv# 12' }), ctxWith([b]), new Set());
    expect(r.action).toBe('pay_existing_bill');
  });
});

// ─── reconcileBatch (claim reservation) ──────────────────────────────────────

describe('reconcileBatch — claim reservation', () => {
  it('same bill matched by two events → older event claims, newer falls to create_bill_then_pay', () => {
    // The INV 12 case from Dan's 2026-08-20 finding
    const b = bill({ txnId: 'BILL-12', refNumber: 'INV 12', amount: 9625, isPaid: false });
    const eA = event({ id: 1, txnDate: '2026-07-01' });
    const eB = event({ id: 2, txnDate: '2026-08-03' });
    const ctx = ctxWith([b]);
    const results = reconcileBatch([eA, eB], ctx);
    const rA = results.find(r => r.event.id === 1)!;
    const rB = results.find(r => r.event.id === 2)!;
    expect(rA.result.action).toBe('pay_existing_bill');
    expect(rA.result.billTxnId).toBe('BILL-12');
    expect(rB.result.action).toBe('create_bill_then_pay');
  });

  it('claims respect chronological order', () => {
    // Two bills available, two events. Older event should claim earlier bill.
    const b1 = bill({ txnId: 'B1', refNumber: 'INV 10', amount: 5000, txnDate: '2026-06-01' });
    const b2 = bill({ txnId: 'B2', refNumber: 'INV 11', amount: 5000, txnDate: '2026-07-01' });
    const eA = event({ id: 1, memo: 'Inv# 10', amount: 5000, txnDate: '2026-06-15' });
    const eB = event({ id: 2, memo: 'Inv# 11', amount: 5000, txnDate: '2026-07-15' });
    const results = reconcileBatch([eB, eA], ctxWith([b1, b2]));
    const rA = results.find(r => r.event.id === 1)!.result;
    const rB = results.find(r => r.event.id === 2)!.result;
    expect(rA.billTxnId).toBe('B1');
    expect(rB.billTxnId).toBe('B2');
  });

  it('mixed batch: some already_done, some pay_existing, some create', () => {
    const paid = bill({ txnId: 'B-paid', refNumber: 'INV 5', amount: 1000, isPaid: true });
    const open = bill({ txnId: 'B-open', refNumber: 'INV 6', amount: 2000, isPaid: false });
    const p = payment({ txnId: 'P-x', appliedToBills: [{ billTxnId: 'B-paid', amount: 1000 }] });
    const events = [
      event({ id: 1, memo: 'Inv# 5', amount: 1000, txnDate: '2026-05-01' }),
      event({ id: 2, memo: 'Inv# 6', amount: 2000, txnDate: '2026-06-01' }),
      event({ id: 3, memo: 'Inv# 999', amount: 3000, txnDate: '2026-07-01' }),
    ];
    const results = reconcileBatch(events, ctxWith([paid, open], [p]));
    expect(results.find(r => r.event.id === 1)!.result.action).toBe('already_done');
    expect(results.find(r => r.event.id === 2)!.result.action).toBe('pay_existing_bill');
    expect(results.find(r => r.event.id === 3)!.result.action).toBe('create_bill_then_pay');
  });
});

// ─── Pre-our-system cutoff (Slice G4d) ──────────────────────────────────────

describe('preOurSystemCutoff', () => {
  const ctxCutoff = (bills: MirrorBill[], cutoff: string): ReconcileContext => ({
    billsByVendor: new Map([[VENDOR, bills]]),
    paymentsByVendor: new Map(),
    preOurSystemCutoff: cutoff,
  });

  it("action='pre_our_system' when event.txnDate < cutoff", () => {
    const r = reconcileEvent(
      event({ txnDate: '2026-02-02' }),
      ctxCutoff([bill()], '2026-06-01'),
      new Set(),
    );
    expect(r.action).toBe('pre_our_system');
    expect(r.reason).toContain('2026-06-01');
    expect(r.billTxnId).toBeUndefined();
  });

  it("cutoff does NOT trigger when event.txnDate >= cutoff (normal reconcile path)", () => {
    const b = bill({ isPaid: false });
    const r = reconcileEvent(
      event({ txnDate: '2026-06-15' }),  // after cutoff
      ctxCutoff([b], '2026-06-01'),
      new Set(),
    );
    expect(r.action).toBe('pay_existing_bill');
  });

  it("no cutoff (undefined) skips the pre_our_system branch", () => {
    const r = reconcileEvent(
      event({ txnDate: '2026-02-02' }),
      ctxWith([bill({ isPaid: false })]),
      new Set(),
    );
    expect(r.action).toBe('pay_existing_bill');   // no cutoff = normal path
  });

  it("cutoff runs BEFORE vendor/kind guardrails (even unmapped events skip)", () => {
    const r = reconcileEvent(
      event({ txnDate: '2026-02-02', counterpartyQbVendorListId: null }),
      ctxCutoff([], '2026-06-01'),
      new Set(),
    );
    expect(r.action).toBe('pre_our_system');   // NOT 'held' for unmapped vendor
  });

  it('batch: mixed pre-cutoff and post-cutoff events', () => {
    const b = bill({ txnId: 'BILL-12', refNumber: 'INV 12', amount: 9625, isPaid: false });
    const events = [
      event({ id: 1, txnDate: '2026-02-01', memo: 'Inv# 5' }),  // pre-cutoff
      event({ id: 2, txnDate: '2026-07-01', memo: 'Inv# 12' }),  // post-cutoff, matches
      event({ id: 3, txnDate: '2026-08-01', memo: 'Inv# 999' }),  // post-cutoff, no match
    ];
    const results = reconcileBatch(events, {
      billsByVendor: new Map([[VENDOR, [b]]]),
      paymentsByVendor: new Map(),
      preOurSystemCutoff: '2026-06-01',
    });
    expect(results.find(r => r.event.id === 1)!.result.action).toBe('pre_our_system');
    expect(results.find(r => r.event.id === 2)!.result.action).toBe('pay_existing_bill');
    expect(results.find(r => r.event.id === 3)!.result.action).toBe('create_bill_then_pay');
  });
});

// ─── Vendor-scoped correctness ───────────────────────────────────────────────

describe('vendor scoping', () => {
  it('does NOT match a bill from a different vendor', () => {
    // Same refNumber INV 12, different vendor
    const otherBill = bill({ txnId: 'B-other', vendorListId: OTHER_VENDOR });
    const ctx: ReconcileContext = {
      billsByVendor: new Map([[OTHER_VENDOR, [otherBill]]]),
      paymentsByVendor: new Map(),
    };
    const r = reconcileEvent(event({ counterpartyQbVendorListId: VENDOR }), ctx, new Set());
    // Our vendor has no data → held
    expect(r.action).toBe('held');
  });
});
