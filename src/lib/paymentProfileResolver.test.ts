import { describe, it, expect } from 'vitest';
import { resolveLivePaymentProfile } from './paymentProfileResolver';
import type { Invoice, PaymentProfile } from '../types';

const PP = (over: Partial<PaymentProfile>): PaymentProfile => ({
  id: 0, userId: 'u1', profileName: '', companyName: '', companyAddress: '',
  country: '', bankName: '', bankAddress: '', bankBranch: '', accountNumber: '',
  iban: '', swift: '', paymentEmail: '', isDefault: false, combinePayments: null,
  converaBeneficiaryId: null, converaMatchOverride: false, qbVendorName: null,
  ...over,
});

const INV = (paymentProfile: PaymentProfile | null, userId = 'u1'): Invoice => ({
  id: 1, invoiceNumber: 'INV 1', userId, userName: 'X', projectId: null,
  periodStart: '2026-01-01', periodEnd: '2026-01-31', lines: [],
  totalHours: null, rate: null, totalAmount: 0, currency: 'USD',
  status: 'submitted', submittedAt: null, reviewedAt: null, reviewedBy: null,
  notes: '', paymentProfile, payOnDate: null, paidDate: null,
  attachmentPath: null, paymentMethodOverride: null, isVendorInvoice: false,
  vendorManagerId: null, source: 'direct', createdBy: null,
  reconciliationStatus: null, reconciliationDelta: null,
  reconciliationNotes: null, groupKey: null, corrected: false,
  paymentTerms: null, qbExportStatus: 'not_exported', qbExportStatusAt: null,
  qbBillTxnId: null, matcherIgnore: false, editHistory: [],
});

describe('resolveLivePaymentProfile (I4)', () => {
  it('returns null when the invoice has no snapshot', () => {
    expect(resolveLivePaymentProfile(INV(null), [PP({ id: 1, isDefault: true })])).toBeNull();
  });

  it('resolves by snapshot id when the profile still exists', () => {
    const live = PP({ id: 42, iban: 'A' });
    const other = PP({ id: 99, iban: 'B' });
    const inv = INV(PP({ id: 42 }));
    expect(resolveLivePaymentProfile(inv, [other, live])).toBe(live);
  });

  it('falls back to same-user + same-iban when id lookup misses', () => {
    const live = PP({ id: 42, userId: 'u1', iban: 'DE1234' });
    const inv = INV(PP({ id: 999, iban: 'DE1234' })); // snapshot id no longer exists
    expect(resolveLivePaymentProfile(inv, [live])).toBe(live);
  });

  it('falls back to user default when id and iban miss', () => {
    const def = PP({ id: 5, userId: 'u1', isDefault: true });
    const other = PP({ id: 6, userId: 'u1' });
    const inv = INV(PP({ id: 999, iban: 'NO_MATCH' }));
    expect(resolveLivePaymentProfile(inv, [other, def])).toBe(def);
  });

  it('returns null when no id / iban / default match', () => {
    const inv = INV(PP({ id: 999, iban: 'X' }));
    expect(resolveLivePaymentProfile(inv, [PP({ id: 5, userId: 'u2', isDefault: true })])).toBeNull();
  });

  it('iban fallback restricts to same-user profiles', () => {
    const otherUsersProfile = PP({ id: 5, userId: 'other', iban: 'A' });
    const inv = INV(PP({ id: 999, iban: 'A' })); // u1
    expect(resolveLivePaymentProfile(inv, [otherUsersProfile])).toBeNull();
  });
});
