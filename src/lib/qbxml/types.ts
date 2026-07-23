// Input types for qbXML request builders.
//
// These types describe what our app hands to the builders — they're
// deliberately reduced from the full DB row types (Invoice, ConveraTransaction,
// PaymentProfile in TimesheetSystem.tsx) to keep the builders decoupled from
// UI/DB concerns and easy to unit-test with plain fixtures.

/** BillQueryRq: look up bills by RefNumber (our invoice_number). */
export interface BillQueryRqInput {
  /** Ref numbers to search for. Corresponds to our `invoices.invoice_number`. */
  refNumbers: string[];
  /** Optional request correlation ID. Web Connector echoes this back on the
   *  response so we can pair request→response when batching multiple ops. */
  requestId?: string;
  /** Optional cap on results. Default: unbounded. */
  maxReturned?: number;
}

/** Result of parseBillQueryRs — one entry per matched bill. */
export interface BillQueryResult {
  refNumber: string;
  txnId: string;
  editSequence: string;
}

/** Common shape for any parsed qbXML response. */
export interface QbxmlResponseStatus {
  /** statusCode="0" is success; anything else is an error. */
  statusCode: string;
  /** "Info" | "Warn" | "Error" — Error means the operation failed. */
  statusSeverity: 'Info' | 'Warn' | 'Error' | string;
  /** Human-readable status message. */
  statusMessage: string;
  /** Echoed requestID if we supplied one. */
  requestId?: string;
}
