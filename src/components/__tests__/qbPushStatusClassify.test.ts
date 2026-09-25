import { describe, it, expect } from 'vitest';
import { classify } from '../QbPushStatusPane';

const done = (id: number) => ({ id, status: 'done' as const, error_msg: null });
const event = { id: 456, status: 'ready', posted_qb_refs: null, resolved_bill_txn_id: '41AE3-1788463211' };

describe('push status classify (pay_bill)', () => {
  it('Convera pilot 2077: both jobs done + bill paid in mirror → verified, even without BillPmt ref on the event', () => {
    const r = classify(done(2077), done(2080), event, { entity_ref: '41AE3-1788463211', is_settled: true, data: null });
    expect(r.overall).toBe('verified-ok');
  });
  it('both jobs done but bill still unpaid → silent drop', () => {
    const r = classify(done(1), done(2), event, { entity_ref: 'B', is_settled: false, data: null });
    expect(r.overall).toBe('silent-drop');
  });
  it('verify still running → verifying', () => {
    const r = classify(done(1), { id: 2, status: 'pending', error_msg: null }, event, null);
    expect(r.overall).toBe('verifying');
  });
});
