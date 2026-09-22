import type { QbIngestKind } from '../../types';
import type { QbOpenBillRow } from '../qbStateSync/types';
import { normalizeRef } from '../intuit/reconcile';

export type Verdict = 'will_create_and_pay' | 'will_pay' | 'will_create_bill';

export interface VerdictInput {
  kind: QbIngestKind | null;
  vendorListId: string | null;
  refNumber: string;
  month: string; // 'YYYY-MM'
}

export function computeVerdict(input: VerdictInput, openBills: QbOpenBillRow[]): Verdict | null {
  if (input.kind !== 'bill_pmt' && input.kind !== 'bill_add_and_pmt') return null;
  if (!input.vendorListId || !input.refNumber || !input.month) return null;

  const wantRef = normalizeRef(input.refNumber);
  if (!wantRef) return null;

  const hasBill = openBills.some(b => {
    if (b.vendorListId !== input.vendorListId) return false;
    if (normalizeRef(b.refNumber) !== wantRef) return false;
    return (b.txnDate ?? '').slice(0, 7) === input.month;
  });

  return hasBill ? 'will_pay' : 'will_create_and_pay';
}
