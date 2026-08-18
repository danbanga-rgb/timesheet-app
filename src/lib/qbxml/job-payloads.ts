// Runtime contract for qb_sync_jobs.payload shapes.
//
// The persist step in the edge fn reads specific keys from each job's payload
// (e.g. sourceConveraTxnId, vendorName). The enqueue scripts must produce
// payloads with matching keys. Historically this was implicit — payload keys
// were duplicated between scripts and the edge fn with nothing enforcing
// agreement, and a rename on one side would silently no-op the other
// (2026-08-14 incident: enqueue wrote `refNumber`, edge fn read
// `confirmationNumber`, and every persist call updated 0 rows in silence).
//
// This module makes the contract explicit:
//   - PAYLOAD_REQUIRED_KEYS[kind]: keys the edge fn's persist step DEPENDS ON.
//   - validatePayload(kind, payload): returns { ok, missing } — the edge fn
//     calls this at the top of persistResponse and returns a loud, specific
//     error if keys are missing.
//
// Adding a new required key to persist? Add it here first. If an enqueue
// script wasn't updated to include it, the very first live job will fail
// with a clear "missing key X" — instead of silently no-op'ing forever.

export type JobKind = 'bill_query' | 'bill_add' | 'bill_pmt_add' | 'account_query' | 'vendor_query' | 'bill_pmt_query';

/** Keys the edge fn's persist step MUST see in the payload for each kind. */
export const PAYLOAD_REQUIRED_KEYS: Record<JobKind, readonly string[]> = {
  // bill_query supports three mutually-exclusive modes (txnIds, refNumbers, iterator).
  // buildBillQueryRq validates the mode contract and throws if payload is under-specified.
  // Persist reads results from the response XML, not the payload — no single required key.
  bill_query: [],
  // bill_add persist uses vendorName from the payload (response echoes it back but
  // reading from payload is simpler and always correct).
  bill_add: ['vendorName', 'refNumber'],
  // bill_pmt_add persist uses sourceConveraTxnId to update the ONE row that spawned
  // the payment. Without it, we can't attribute the payment back. Was the 2026-08-14
  // bug — enqueue omitted this field entirely and persist silently no-op'd.
  bill_pmt_add: ['sourceConveraTxnId', 'refNumber', 'payeeVendorName', 'applications'],
  // Query-only jobs — the response IS the payload from our POV. Nothing required.
  account_query: [],
  vendor_query: [],
  // Exploratory read-only query. Payload carries a raw qbxml_request string that
  // the dispatcher sends through unmodified. Persist is a no-op — response is
  // inspected manually via qb_sync_jobs.qbxml_response.
  bill_pmt_query: ['rawQbxmlRequest'],
};

export interface ValidatePayloadResult {
  ok: boolean;
  missing: string[];
}

/** Check that the payload has every required key for its kind, with a defined value. */
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
