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

export type JobKind = 'bill_query' | 'bill_add' | 'bill_pmt_add' | 'check_add' | 'account_query' | 'vendor_query' | 'bill_pmt_query';

/** Either every listed key must be present, OR at least one of the `oneOf` groups
 *  must have all its members present (and `required` is still enforced).
 *  Legacy shape: bare `readonly string[]` == { required: [...], oneOf: [] }. */
export type PayloadRequirement = readonly string[] | {
  required?: readonly string[];
  /** Array of key-groups. AT LEAST ONE group must have every member defined. */
  oneOf?: ReadonlyArray<readonly string[]>;
};

/** Keys the edge fn's persist step MUST see in the payload for each kind. */
export const PAYLOAD_REQUIRED_KEYS: Record<JobKind, PayloadRequirement> = {
  // bill_query supports three mutually-exclusive modes (txnIds, refNumbers, iterator).
  // buildBillQueryRq validates the mode contract and throws if payload is under-specified.
  // Persist reads results from the response XML, not the payload — no single required key.
  bill_query: [],
  // bill_add persist uses vendorName from the payload (response echoes it back but
  // reading from payload is simpler and always correct).
  bill_add: ['vendorName', 'refNumber'],
  // bill_pmt_add persist uses a source-ref back to the row that spawned the payment.
  // Convera path: sourceConveraTxnId + refNumber (OTR wire code). 2026-08-14 incident:
  // enqueue omitted the source ref, persist silently no-op'd.
  // Intuit path (Slice G7+): sourceIngestEventId, blank RefNumber per accountant's
  // historic convention (verified 2026-08-17 against QB — see [[intuit-push-context]]).
  bill_pmt_add: {
    required: ['payeeVendorName', 'applications'],
    oneOf: [['refNumber', 'sourceConveraTxnId'], ['sourceIngestEventId']],
  },
  // check_add (Slice E of QB Automation Layer): direct expense check.
  // persist uses sourceIngestEventId to update the ONE qb_ingest_events row that
  // spawned the check, setting posted_qb_refs.check = TxnID and status = 'posted'.
  // Also needs payeeVendorName + bankAccountName + lines for the build itself.
  check_add: ['sourceIngestEventId', 'payeeVendorName', 'bankAccountName', 'lines'],
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
  /** Populated when a oneOf group check failed. Explains which groups were tried. */
  oneOfFailure?: string;
}

/** Check that the payload has every required key for its kind, with a defined value.
 *  Supports both bare-array (legacy) and { required, oneOf } shape. */
export function validatePayload(kind: JobKind, payload: unknown): ValidatePayloadResult {
  const spec = PAYLOAD_REQUIRED_KEYS[kind];
  let required: readonly string[];
  let oneOfGroups: ReadonlyArray<readonly string[]>;
  if (Array.isArray(spec)) {
    required = spec;
    oneOfGroups = [];
  } else {
    // TS can't narrow the union to the object branch after Array.isArray on a
    // union that includes a readonly array — cast explicitly.
    const objSpec = spec as { required?: readonly string[]; oneOf?: ReadonlyArray<readonly string[]> };
    required = objSpec.required ?? [];
    oneOfGroups = objSpec.oneOf ?? [];
  }
  if (required.length === 0 && oneOfGroups.length === 0) return { ok: true, missing: [] };

  const record = (payload && typeof payload === 'object')
    ? (payload as Record<string, unknown>)
    : null;

  const missing: string[] = [];
  if (record == null) {
    missing.push(...required);
    return { ok: false, missing };
  }
  for (const key of required) {
    if (record[key] === undefined || record[key] === null) missing.push(key);
  }
  if (missing.length > 0) return { ok: false, missing };

  if (oneOfGroups.length === 0) return { ok: true, missing: [] };

  const groupOk = oneOfGroups.some(group =>
    group.every(key => record[key] !== undefined && record[key] !== null),
  );
  if (groupOk) return { ok: true, missing: [] };

  const desc = oneOfGroups.map(g => `[${g.join(',')}]`).join(' OR ');
  return {
    ok: false,
    missing: [],
    oneOfFailure: `payload for '${kind}' must satisfy one of: ${desc}`,
  };
}
