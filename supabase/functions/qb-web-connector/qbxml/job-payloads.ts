// Runtime contract for qb_sync_jobs.payload shapes.
// See src/lib/qbxml/job-payloads.ts for full docs. Keep in sync.

export type JobKind = 'bill_query' | 'bill_add' | 'bill_pmt_add' | 'account_query' | 'vendor_query';

export const PAYLOAD_REQUIRED_KEYS: Record<JobKind, readonly string[]> = {
  bill_query: ['refNumbers'],
  bill_add: ['vendorName', 'refNumber'],
  bill_pmt_add: ['sourceConveraTxnId', 'refNumber', 'payeeVendorName', 'applications'],
  account_query: [],
  vendor_query: [],
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
