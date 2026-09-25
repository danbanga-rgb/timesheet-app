import { describe, it, expect } from 'vitest';
import { umbrellaGroupTitle, umbrellaGroupVerdict } from '../useQbAutomationV2';

describe('umbrellaGroupVerdict', () => {
  it('Bimosoft Jul 2026: reconciler says pay existing bills → Will Pay, even when the single-vendor lookup missed', () => {
    // Wire 452 is mapped to Edin's vendor; the lookup used Bojan's ref under it → no bill → will_create_and_pay.
    expect(umbrellaGroupVerdict('pay_existing_bill', 'will_create_and_pay')).toBe('will_pay');
  });
  it('create_bill_then_pay → Will Create + Pay', () => {
    expect(umbrellaGroupVerdict('create_bill_then_pay', 'will_pay')).toBe('will_create_and_pay');
  });
  it('undecided reconciler → mirror fallback, then create + pay', () => {
    expect(umbrellaGroupVerdict(null, 'will_pay')).toBe('will_pay');
    expect(umbrellaGroupVerdict('held', null)).toBe('will_create_and_pay');
  });
});

describe('umbrellaGroupTitle', () => {
  it('multi-vendor wire uses the wire payee', () => {
    expect(umbrellaGroupTitle(2, 'BIMOSOFT E OU', 'Bimosoft - Edin Jasarspahic')).toBe('BIMOSOFT E OU');
  });
  it('single-vendor group keeps the QB vendor (Teal, Epiisa)', () => {
    expect(umbrellaGroupTitle(1, 'TEAL CROSSROADS LLC', 'Teal Crossroads')).toBe('Teal Crossroads');
  });
  it('multi-vendor with a blank payee falls back to the vendor name', () => {
    expect(umbrellaGroupTitle(2, '  ', 'Bimosoft - Edin Jasarspahic')).toBe('Bimosoft - Edin Jasarspahic');
  });
});
