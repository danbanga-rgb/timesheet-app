// intuitPush — G7a consumer tests.
//
// Verifies:
//  - eligible pay_existing_bill events → executor enqueues pay_bill jobs
//  - non-eligible events (wrong resolvedAction, missing fields, status=posted)
//    are skippedIneligible, never reach the executor
//  - vendor/bank list_id → name lookup surfaces missing rows as skipped
//  - executor's own rejections/duplicates flow through unchanged

import { describe, it, expect } from 'vitest';
import { pushIntuitPayBill } from '../intuitPush';

type Row = Record<string, unknown>;

// Minimal Supabase mock compatible with executor's chain shapes.
// Extends execute.test.ts's shape with support for `qb_ingest_events`, `qb_vendors`,
// `qb_accounts` selects. See execute.ts for the exact chain patterns exercised.
function makeMockSupabase(tables: Record<string, Row[]>) {
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  let nextId = 9000;
  const client = {
    from(tableName: string) {
      const rows = (tables[tableName] ?? []) as Row[];
      const query = {
        _rows: [...rows],
        insert(newRows: Row[]) {
          inserts.push({ table: tableName, rows: newRows });
          return {
            select() {
              const data = newRows.map(() => ({ id: nextId++ }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
        select() { return this; },
        in(col: string, values: unknown[]) {
          this._rows = this._rows.filter(r => values.includes(r[col]));
          return this;
        },
        eq(col: string, value: unknown) {
          this._rows = this._rows.filter(r => r[col] === value);
          return this;
        },
        not(col: string, op: string, value: unknown) {
          if (op === 'is' && value === null) this._rows = this._rows.filter(r => r[col] != null);
          return this;
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return resolve({ data: this._rows, error: null });
        },
      };
      return query;
    },
  };
  return { client: client as unknown as Parameters<typeof pushIntuitPayBill>[0], inserts };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const readyEvent = {
  id: 42,
  txn_date: '2026-08-15',
  amount: 5000,
  counterparty_qb_vendor_list_id: 'V-HOVER',
  qb_bank_account_list_id: 'A-8220',
  resolved_action: 'pay_existing_bill',
  resolved_bill_txn_id: 'HOVER-BILL-TXN',
  status: 'ready',
  matched_invoice_ids: [901],
  match_provenance: 'exact-txn',
};

const vendors = [{ list_id: 'V-HOVER', name: 'Hovercloud Technologies' }];
const accounts = [{ list_id: 'A-8220', full_name: 'BANK/CASH:8220 - Key Point Checking' }];
// Default mirror: bill matches event amount exactly + unsettled. Individual tests
// override to exercise amount-mismatch / already-settled / missing paths.
const qbMirror = [
  { entity_kind: 'bill', entity_ref: 'HOVER-BILL-TXN', vendor_list_id: 'V-HOVER',
    amount: 5000, is_settled: false,
    data: { vendor_full_name: 'Hovercloud Technologies', open_amount: 5000 } },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('pushIntuitPayBill', () => {
  it('no-op on empty input', async () => {
    const { client, inserts } = makeMockSupabase({});
    const r = await pushIntuitPayBill(client, []);
    expect(r).toEqual({ jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible: [], verifyJobIdByPayJobId: {} });
    expect(inserts).toHaveLength(0);
  });

  it('enqueues one pay_bill for a ready pay_existing_bill event + a verify bill_query with depends_on', async () => {
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [42], { auditTag: 'test-tag' });
    expect(r.rejected).toEqual([]);
    expect(r.skippedDuplicate).toEqual([]);
    expect(r.skippedIneligible).toEqual([]);
    expect(r.jobIds).toEqual([9000]);
    // Two inserts into qb_sync_jobs: the pay_bill then the follow-up bill_query.
    const jobInserts = inserts.filter(i => i.table === 'qb_sync_jobs');
    expect(jobInserts).toHaveLength(2);
    const payJob = jobInserts[0].rows[0] as Record<string, unknown>;
    expect(payJob.kind).toBe('bill_pmt_add');
    const payload = payJob.payload as Record<string, unknown>;
    expect(payload.payeeVendorName).toBe('Hovercloud Technologies');
    expect(payload.bankAccountName).toBe('BANK/CASH:8220 - Key Point Checking');
    expect(payload.sourceIngestEventId).toBe(42);
    expect(payload.refNumber).toBeUndefined();               // Intuit historic convention — blank RefNumber
    expect(payload.memo).toBe('ingest:42');                  // traceability into QB
    expect(payload.__audit_tag).toBe('test-tag');
    expect(payload.applications).toEqual([{ billTxnId: 'HOVER-BILL-TXN', paymentAmount: 5000 }]);
    // INVARIANTS #36 — verify chain
    const verifyJob = jobInserts[1].rows[0] as Record<string, unknown>;
    expect(verifyJob.kind).toBe('bill_query');
    expect(verifyJob.depends_on).toEqual([9000]);            // waits for pay to complete
    const verifyPayload = verifyJob.payload as Record<string, unknown>;
    expect(verifyPayload.txnIds).toEqual(['HOVER-BILL-TXN']);
    expect(verifyPayload.__verify_for_event_id).toBe(42);
    expect(r.verifyJobIdByPayJobId).toEqual({ 9000: 9001 });  // pay=9000, verify=9001 (shared counter)
  });

  it('skips events with resolved_action != pay_existing_bill', async () => {
    const wrongAction = { ...readyEvent, id: 43, resolved_action: 'create_bill_then_pay' };
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [wrongAction], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [43]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible).toHaveLength(1);
    expect(r.skippedIneligible[0].eventId).toBe(43);
    expect(r.skippedIneligible[0].reason).toMatch(/pay_existing_bill only/);
    expect(inserts.filter(i => i.table === 'qb_sync_jobs')).toHaveLength(0);
  });

  it('skips events with status=posted (never re-push)', async () => {
    const posted = { ...readyEvent, id: 44, status: 'posted' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [posted], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [44]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible).toHaveLength(1);
    expect(r.skippedIneligible[0].reason).toMatch(/already pushed/);
  });

  it('skips events with missing resolved_bill_txn_id', async () => {
    const missingBill = { ...readyEvent, id: 45, resolved_bill_txn_id: null };
    const { client } = makeMockSupabase({
      qb_ingest_events: [missingBill], qb_vendors: vendors, qb_accounts: accounts,
    });
    const r = await pushIntuitPayBill(client, [45]);
    expect(r.skippedIneligible[0].reason).toMatch(/resolved_bill_txn_id missing/);
  });

  it('skips events with missing counterparty_qb_vendor_list_id', async () => {
    const missingVendor = { ...readyEvent, id: 46, counterparty_qb_vendor_list_id: null };
    const { client } = makeMockSupabase({
      qb_ingest_events: [missingVendor], qb_vendors: vendors, qb_accounts: accounts,
    });
    const r = await pushIntuitPayBill(client, [46]);
    expect(r.skippedIneligible[0].reason).toMatch(/counterparty_qb_vendor_list_id missing/);
  });

  it('skips events with missing qb_bank_account_list_id', async () => {
    const missingBank = { ...readyEvent, id: 47, qb_bank_account_list_id: null };
    const { client } = makeMockSupabase({
      qb_ingest_events: [missingBank], qb_vendors: vendors, qb_accounts: accounts,
    });
    const r = await pushIntuitPayBill(client, [47]);
    expect(r.skippedIneligible[0].reason).toMatch(/qb_bank_account_list_id missing/);
  });

  it('skips non-existent event ids', async () => {
    const { client } = makeMockSupabase({ qb_ingest_events: [] });
    const r = await pushIntuitPayBill(client, [999]);
    expect(r.skippedIneligible).toHaveLength(1);
    expect(r.skippedIneligible[0]).toEqual({ eventId: 999, reason: 'not found in qb_ingest_events' });
  });

  it('skips when qb_vendors row missing for the vendor list_id (mirror out of sync)', async () => {
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: [], qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/qb_vendors row missing/);
  });

  it('skips when qb_accounts row missing for the bank list_id (mirror out of sync)', async () => {
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: [], qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/qb_accounts row missing/);
  });

  it('partitions mixed batch — enqueues eligible, skips ineligible in one call', async () => {
    const wrongAction = { ...readyEvent, id: 100, resolved_action: 'check' };
    const ready = { ...readyEvent, id: 101 };
    // Second mirror row for the second event (same TxnID but the read is per-event
    // via .in on entity_ref, so a single row keyed by the shared bill txn is fine).
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [wrongAction, ready], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [100, 101]);
    expect(r.jobIds).toEqual([9000]);
    expect(r.skippedIneligible.map(s => s.eventId)).toEqual([100]);
    const payJob = inserts.filter(i => i.table === 'qb_sync_jobs')[0];
    expect((payJob.rows[0].payload as Record<string, unknown>).sourceIngestEventId).toBe(101);
  });

  // ─── Provenance gate (invoice-linking trust level) ───────────────────────

  it('refuses to push events with match_provenance=fuzzy (weak invoice link)', async () => {
    const fuzzy = { ...readyEvent, id: 200, match_provenance: 'fuzzy' };
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [fuzzy], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [200]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible).toHaveLength(1);
    expect(r.skippedIneligible[0].reason).toMatch(/match_provenance='fuzzy'/);
    expect(inserts.filter(i => i.table === 'qb_sync_jobs')).toHaveLength(0);
  });

  it('refuses to push events with match_provenance=empty', async () => {
    const empty = { ...readyEvent, id: 201, match_provenance: 'empty', matched_invoice_ids: [] };
    const { client } = makeMockSupabase({
      qb_ingest_events: [empty], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [201]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/match_provenance='empty'/);
  });

  it('refuses to push events with match_provenance=null (reconciler never ran)', async () => {
    const noProv = { ...readyEvent, id: 202, match_provenance: null };
    const { client } = makeMockSupabase({
      qb_ingest_events: [noProv], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [202]);
    expect(r.skippedIneligible[0].reason).toMatch(/match_provenance='null'/);
  });

  it('accepts events with match_provenance=exact-ref (memo names the invoice)', async () => {
    const ref = { ...readyEvent, id: 203, match_provenance: 'exact-ref' };
    const { client } = makeMockSupabase({
      qb_ingest_events: [ref], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [203]);
    expect(r.jobIds).toEqual([9000]);
    expect(r.skippedIneligible).toEqual([]);
  });

  it('refuses to push exact-txn event whose matched_invoice_ids is somehow empty', async () => {
    // Defense-in-depth: shouldn't happen (exact-txn implies matched=[authoritativeId])
    // but the gate blocks anyway to prevent orphan pushes.
    const emptyMatched = { ...readyEvent, id: 204, matched_invoice_ids: [] };
    const { client } = makeMockSupabase({
      qb_ingest_events: [emptyMatched], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: qbMirror,
    });
    const r = await pushIntuitPayBill(client, [204]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible[0].reason).toMatch(/matched_invoice_ids is empty/);
  });

  // ─── Dupe guard (invoice mapped to multiple events) ───────────────────────

  it('refuses BOTH events when they map to the same primary invoice', async () => {
    const a = { ...readyEvent, id: 300, matched_invoice_ids: [777] };
    const b = { ...readyEvent, id: 301, matched_invoice_ids: [777], resolved_bill_txn_id: 'HOVER-BILL-TXN-2' };
    const mirror2 = [
      ...qbMirror,
      { entity_kind: 'bill', entity_ref: 'HOVER-BILL-TXN-2', vendor_list_id: 'V-HOVER',
        amount: 5000, is_settled: false,
        data: { vendor_full_name: 'Hovercloud Technologies', open_amount: 5000 } },
    ];
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [a, b], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: mirror2,
    });
    const r = await pushIntuitPayBill(client, [300, 301]);
    expect(r.jobIds).toEqual([]);
    const reasons = r.skippedIneligible.map(s => s.reason);
    expect(reasons.every(r => /duplicate invoice-mapping/.test(r))).toBe(true);
    expect(r.skippedIneligible.map(s => s.eventId).sort()).toEqual([300, 301]);
    expect(inserts.filter(i => i.table === 'qb_sync_jobs')).toHaveLength(0);
  });

  // ─── Amount-equality gate (INVARIANTS #36 co-safety) ─────────────────────

  it('refuses to push if event.amount != qb_mirror open_amount (partial-payment block)', async () => {
    const mirrorMismatch = [{
      entity_kind: 'bill', entity_ref: 'HOVER-BILL-TXN', vendor_list_id: 'V-HOVER',
      amount: 5000, is_settled: false,
      data: { vendor_full_name: 'Hovercloud Technologies', open_amount: 4000 },  // partial
    }];
    const { client, inserts } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: mirrorMismatch,
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.jobIds).toEqual([]);
    expect(r.skippedIneligible).toHaveLength(1);
    expect(r.skippedIneligible[0].reason).toMatch(/amount-mismatch/);
    expect(r.skippedIneligible[0].reason).toContain('5000.00');
    expect(r.skippedIneligible[0].reason).toContain('4000.00');
    expect(inserts.filter(i => i.table === 'qb_sync_jobs')).toHaveLength(0);
  });

  it('refuses to push if qb_mirror bill is already settled (IsPaid=true)', async () => {
    const mirrorSettled = [{
      entity_kind: 'bill', entity_ref: 'HOVER-BILL-TXN', vendor_list_id: 'V-HOVER',
      amount: 5000, is_settled: true,
      data: { vendor_full_name: 'Hovercloud Technologies', open_amount: 0 },
    }];
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: mirrorSettled,
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.skippedIneligible[0].reason).toMatch(/already settled/);
  });

  it('refuses to push if qb_mirror has no row for the resolved bill (stale mirror)', async () => {
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: [],
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.skippedIneligible[0].reason).toMatch(/qb_mirror bill missing/);
  });

  it('tolerates 2dp float noise in amount comparison', async () => {
    const nearlyEqualMirror = [{
      entity_kind: 'bill', entity_ref: 'HOVER-BILL-TXN', vendor_list_id: 'V-HOVER',
      amount: 5000, is_settled: false,
      data: { vendor_full_name: 'Hovercloud Technologies', open_amount: 5000.001 },  // sub-penny noise
    }];
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: nearlyEqualMirror,
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.jobIds).toEqual([9000]);
    expect(r.skippedIneligible).toEqual([]);
  });

  it('executor idempotency — already-posted event → skippedDuplicate (not skippedIneligible)', async () => {
    // Consumer catches status=posted itself. To force idempotency at the executor,
    // seed a qb_ingest_events row with status='ready' and ALSO a posted marker
    // in the idempotency check (i.e. the executor sees the same event id as posted).
    // Simulate: executor's findDuplicates re-queries qb_ingest_events with status='posted' filter.
    // Here we mark the row 'ready' for our fetch but 'posted' for executor by using
    // two different rows keyed on `.eq('status','posted')` — the mock filters by exact match.
    // Simpler: rely on the vendor-scoped in-flight check by seeding qb_sync_jobs with a
    // pending job for the same sourceIngestEventId.
    const inflight = [{
      id: 555, kind: 'bill_pmt_add', status: 'pending',
      payload: { sourceIngestEventId: 42, payeeVendorName: 'Hovercloud Technologies' },
    }];
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: accounts,
      qb_mirror: qbMirror, qb_sync_jobs: inflight,
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.skippedDuplicate).toHaveLength(1);
    expect(r.skippedDuplicate[0].reason).toMatch(/in-flight/);
    expect(r.jobIds).toEqual([null]);
  });

  it('vendor mismatch surfaces from executor #11 — payeeVendorName ≠ bill.vendor', async () => {
    // qb_mirror bill belongs to a DIFFERENT vendor than the event's classifier output.
    // Amount + is_settled must be present so we get past the consumer's amount-equality gate.
    const mismatchMirror = [{
      entity_kind: 'bill', entity_ref: 'HOVER-BILL-TXN', vendor_list_id: 'V-OTHER',
      amount: 5000, is_settled: false,
      data: { vendor_full_name: 'Some Other Vendor', open_amount: 5000 },
    }];
    const { client } = makeMockSupabase({
      qb_ingest_events: [readyEvent], qb_vendors: vendors, qb_accounts: accounts, qb_mirror: mismatchMirror,
    });
    const r = await pushIntuitPayBill(client, [42]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].invariant).toMatch(/#11/);
    expect(r.rejected[0].reason).toMatch(/vendor-mismatch/);
    expect(r.jobIds).toEqual([null]);
  });
});
