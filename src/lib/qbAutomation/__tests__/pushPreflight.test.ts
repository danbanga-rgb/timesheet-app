import { describe, it, expect } from 'vitest';
import { converaWirePreflight, invoiceCreateBillPreflight, type PreflightBill, type PreflightContext, type PreflightInvoice } from '../pushPreflight';

const inv = (o: Partial<PreflightInvoice> & { id: number }): PreflightInvoice => ({
  userId: 'u', invoiceNumber: `INV ${o.id}`, status: 'approved', periodEnd: '2026-07-31',
  totalAmount: 1000, qbBillTxnId: null, paymentMethodOverride: 'Convera', matcherIgnore: false, ...o,
});
const bill = (o: Partial<PreflightBill> & { txnId: string }): PreflightBill => ({
  vendorListId: 'V', refNumber: 'R', isPaid: false, ...o,
});
const ctxOf = (invoices: PreflightInvoice[], bills: PreflightBill[] = []): PreflightContext => ({
  allInvoices: invoices, bills, billsByTxnId: new Map(bills.map(b => [b.txnId, b])),
});

describe('converaWirePreflight', () => {
  it('clean single-invoice wire with an unpaid bill of the same amount → pushable', () => {
    const i = inv({ id: 244, qbBillTxnId: 'B1', totalAmount: 2880 });
    expect(converaWirePreflight({ amount: 2880, matchedInvoiceIds: [244] }, [], new Map(), ctxOf([i], [bill({ txnId: 'B1' })]))).toBeNull();
  });

  it('Bimosoft 452: wire links 2 invoices but only 1 is matched → blocked', () => {
    const edin = inv({ id: 246, userId: 'edin', qbBillTxnId: 'B-E', totalAmount: 3520 });
    const bojan = inv({ id: 250, userId: 'bojan', qbBillTxnId: 'B-B', totalAmount: 5760 });
    const r = converaWirePreflight({ amount: 9280, matchedInvoiceIds: [246] }, [246, 250], new Map([[246, 3520], [250, 5760]]),
      ctxOf([edin, bojan], [bill({ txnId: 'B-E' }), bill({ txnId: 'B-B' })]));
    expect(r).toMatch(/covers 2 invoices but only 1/);
  });

  it('Izet 470: matched invoice reuses the July number → blocked with a rename hint', () => {
    const jul = inv({ id: 192, userId: 'izet', invoiceNumber: 'INV 20260801', status: 'paid', qbBillTxnId: 'B-JUL', totalAmount: 3680 });
    const aug = inv({ id: 256, userId: 'izet', invoiceNumber: 'INV 20260801', qbBillTxnId: 'B-JUL', totalAmount: 3360, periodEnd: '2026-08-31' });
    const r = converaWirePreflight({ amount: 3680, matchedInvoiceIds: [256] }, [], new Map(), ctxOf([jul, aug], [bill({ txnId: 'B-JUL' })]));
    expect(r).toMatch(/also used on this contractor's invoice #192.*-1/);
  });

  it('Teal: 6 contractors in one group share one combined bill → not flagged', () => {
    const members = [1, 2, 3].map(n => inv({ id: 220 + n, userId: `teal-${n}`, invoiceNumber: 'INV 002/08/2026', qbBillTxnId: 'B-TEAL', groupKey: 'g-teal', totalAmount: 100 }));
    const r = converaWirePreflight({ amount: 300, matchedInvoiceIds: [221, 222, 223] }, [], new Map(), ctxOf(members, [bill({ txnId: 'B-TEAL' })]));
    expect(r).toBeNull();
  });

  it('same bill on two invoices of the SAME contractor → flagged even inside a group', () => {
    const a = inv({ id: 1, userId: 'x', invoiceNumber: 'A', qbBillTxnId: 'B', groupKey: 'g' });
    const b = inv({ id: 2, userId: 'x', invoiceNumber: 'B', qbBillTxnId: 'B', groupKey: 'g' });
    expect(converaWirePreflight({ amount: 1000, matchedInvoiceIds: [1] }, [], new Map(), ctxOf([a, b], [bill({ txnId: 'B' })])))
      .toMatch(/also linked to invoice #2/);
  });

  it('bill already paid in QB → blocked', () => {
    const i = inv({ id: 1, qbBillTxnId: 'B1' });
    expect(converaWirePreflight({ amount: 1000, matchedInvoiceIds: [1] }, [], new Map(), ctxOf([i], [bill({ txnId: 'B1', isPaid: true })])))
      .toMatch(/already paid/);
  });

  it('bill not in mirror → blocked; amount mismatch → blocked', () => {
    const i = inv({ id: 1, qbBillTxnId: 'B1' });
    expect(converaWirePreflight({ amount: 1000, matchedInvoiceIds: [1] }, [], new Map(), ctxOf([i]))).toMatch(/isn't in the QB Mirror/);
    expect(converaWirePreflight({ amount: 1200, matchedInvoiceIds: [1] }, [], new Map(), ctxOf([i], [bill({ txnId: 'B1' })])))
      .toMatch(/doesn't match invoice #1/);
  });
});

describe('invoiceCreateBillPreflight', () => {
  it('YARA INV 13 (Intuit, no bill anywhere) → pushable', () => {
    const y = inv({ id: 312, invoiceNumber: 'INV 13', paymentMethodOverride: 'Intuit', periodEnd: '2026-08-31' });
    expect(invoiceCreateBillPreflight([y], 'Intuit', 'V-YARA', ctxOf([y], [bill({ txnId: 'X', vendorListId: 'V-YARA', refNumber: 'INV 12' })]))).toBeNull();
  });

  it('Mensur Aug: already carries July bill ID + reused number → blocked', () => {
    const jul = inv({ id: 193, userId: 'mensur', invoiceNumber: 'INV 01/07/2026', status: 'paid', qbBillTxnId: 'B7' });
    const aug = inv({ id: 251, userId: 'mensur', invoiceNumber: 'INV 01/07/2026', qbBillTxnId: 'B7', periodEnd: '2026-08-31' });
    expect(invoiceCreateBillPreflight([aug], 'Convera', 'V', ctxOf([jul, aug]))).toMatch(/also used on this contractor's invoice #193/);
  });

  it('QB already has a bill with this number for the vendor → blocked', () => {
    const i = inv({ id: 5, invoiceNumber: 'INV 5' });
    expect(invoiceCreateBillPreflight([i], 'Convera', 'V', ctxOf([i], [bill({ txnId: 'B', vendorListId: 'V', refNumber: 'INV 5' })])))
      .toMatch(/QB already has a bill "INV 5"/);
  });

  it('no method / unsaved method / before cutoff → blocked', () => {
    const i = inv({ id: 6 });
    expect(invoiceCreateBillPreflight([i], '', 'V', ctxOf([i]))).toMatch(/No payment method/);
    expect(invoiceCreateBillPreflight([{ ...i, paymentMethodOverride: null }], 'Convera', 'V', ctxOf([i]))).toMatch(/isn't saved/);
    expect(invoiceCreateBillPreflight([{ ...i, periodEnd: '2026-03-31' }], 'Convera', 'V', ctxOf([i]))).toMatch(/cutoff/);
  });
});
