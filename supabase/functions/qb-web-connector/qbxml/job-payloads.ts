// Runtime contract for qb_sync_jobs.payload shapes.
// See src/lib/qbxml/job-payloads.ts for full docs. Keep in sync.

export type JobKind = 'bill_query' | 'bill_add' | 'bill_pmt_add' | 'account_query' | 'vendor_query' | 'bill_pmt_query';

export const PAYLOAD_REQUIRED_KEYS: Record<JobKind, readonly string[]> = {
  // bill_query supports three mutually-exclusive modes (txnIds, refNumbers, iterator).
  // buildBillQueryRq validates the mode contract and throws if payload is under-specified.
  // No single required key here — bill_query persist reads results from the response,
  // not from the payload.
  bill_query: [],
  bill_add: ['vendorName', 'refNumber'],
  bill_pmt_add: ['sourceConveraTxnId', 'refNumber', 'payeeVendorName', 'applications'],
  account_query: [],
  vendor_query: [],
  bill_pmt_query: ['rawQbxmlRequest'],
};

export interface ValidatePayloadResult {
  ok: boolean;
  missing: string[];
}

export function validatePayload(kind: JobKind, payload: unknown): ValidatePayloadResult {
  const required = PAYLOAD_REQUIRED_KEYS[kind];
  if (!required || required.length === 0) return { ok: true, missing: [] };
  if (payload == null || typeof payload !== 'object') {
    return { ok: false, missing: [...required] };
  }
  const record = payload as Record<string, unknown>;
  const missing: string[] = [];
  for (const key of required) {
    if (record[key] === undefined || record[key] === null) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
}
