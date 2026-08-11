// qbXML response parsers — pure functions, no I/O.
//
// Consumes response envelopes from the QuickBooks Web Connector and extracts
// the header-level fields we care about (status attributes, TxnID,
// EditSequence, RefNumber). Complements the builders in ./builders.ts:
// what those emit, these consume on the way back.
//
// Session 3 shipped the three request builders. Session 4 (this session)
// ships the corresponding response parsers.
//
// Zero-dependency by design (matches Sessions 1–3 aesthetic). The extractors
// are TARGETED — not a general XML parser. They handle exactly the qbXML
// response shapes we know we'll see from QB Desktop 2020 Pro over qbXML 13.0.
//
// The one real trap: qbXML BillRet contains nested <LinkedTxn> sub-blocks
// that carry their own <TxnID> and <RefNumber> children. A naïve
// first-occurrence extractor would pull the wrong values on any bill with
// linked payment or credit history. We strip LinkedTxn (and other nested
// blocks) before leaf extraction, and lock the behavior with a dedicated
// test using a real BillQueryRs response containing LinkedTxn payload.

import type {
  BillAddResult,
  BillPaymentCheckAddResult,
  BillQueryResult,
  ParsedBillAddRs,
  ParsedBillPaymentCheckAddRs,
  ParsedBillQueryRs,
  QbxmlResponseStatus,
} from './types.ts';

// ─── Private helpers ────────────────────────────────────────────────────────

/** Reverse of xmlEscape in envelope.ts. Order does not matter here — the
 *  five sequences are non-overlapping after being emitted, since xmlEscape
 *  always turns `&` into `&amp;` first. */
function xmlUnescape(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Remove every occurrence of `<tag ...>...</tag>` and `<tag .../>` from `fragment`.
 *
 *  Used specifically to strip nested container sub-blocks (e.g. LinkedTxn)
 *  from a Ret block before extracting header-level leaf fields. Assumes:
 *  - The stripped tag does NOT nest inside itself (true for every qbXML
 *    container we strip — LinkedTxn, ExpenseLineRet, etc.).
 *  - The stripped tag's content contains no unescaped `<`/`>` outside child
 *    elements (true — qbXML always escapes).
 *  Lazy match with `[\s\S]*?` is therefore safe. */
function stripAllOccurrences(fragment: string, tag: string): string {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</${tag}>)`,
    'g',
  );
  return fragment.replace(pattern, '');
}

/** Extract the text content of the FIRST `<tag>text</tag>` occurrence in
 *  `fragment`. Text must contain no child elements — this is a leaf-only
 *  extractor. Returns null if not found.
 *
 *  Handles: attribute-bearing opening tags, self-closing (returns empty
 *  string), entity-decoded text. Does NOT handle CDATA specially; CDATA
 *  content is returned as-is (unlikely from QB but noted for auditors).
 *  Case-sensitive (qbXML is always PascalCase).
 */
function getLeafText(fragment: string, tag: string): string | null {
  // Self-closing first: <Memo/> or <Memo />
  const selfClosingPattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?/>`,
  );
  if (selfClosingPattern.test(fragment)) return '';
  // Standard: <tag>text</tag> or <tag attrs>text</tag>. Text may not contain '<'.
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`,
  );
  const m = fragment.match(pattern);
  return m ? xmlUnescape(m[1]) : null;
}

/** Extract the value of an attribute from a serialized opening tag string
 *  (e.g. `<BillQueryRs requestID="q-1" statusCode="0">`). Returns null if
 *  the attribute is absent. Supports both double- and single-quoted values. */
function getAttr(openingTag: string, attr: string): string | null {
  const dq = new RegExp(`\\s${attr}="([^"]*)"`);
  const sq = new RegExp(`\\s${attr}='([^']*)'`);
  const m = openingTag.match(dq) ?? openingTag.match(sq);
  return m ? xmlUnescape(m[1]) : null;
}

/** Return every top-level `<tag ...>...</tag>` block inside `fragment` as an
 *  array of full block strings (opening tag + content + closing tag).
 *
 *  Assumes `tag` does not nest inside itself in the source (true for every
 *  qbXML "return" block: BillRet, BillPaymentCheckRet, etc. — QB never nests
 *  these). Lazy match; skips self-closing forms since return blocks are
 *  never self-closing. */
function getAllBlocks(fragment: string, tag: string): string[] {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`,
    'g',
  );
  return fragment.match(pattern) ?? [];
}

/** Return the opening tag string and inner content of the FIRST occurrence
 *  of `<tag ...>...</tag>` in `fragment`. Used for the top-level response
 *  element (e.g. `<BillQueryRs ...>...</BillQueryRs>`) whose attributes
 *  carry statusCode / statusSeverity / statusMessage / requestID.
 *
 *  Returns null if not found. Ignores self-closing forms (no response element
 *  is self-closing). */
function getFirstElement(
  fragment: string,
  tag: string,
): { openingTag: string; inner: string } | null {
  const pattern = new RegExp(
    `(<${tag}(?:\\s[^>]*)?>)([\\s\\S]*?)</${tag}>`,
  );
  const m = fragment.match(pattern);
  return m ? { openingTag: m[1], inner: m[2] } : null;
}

/** Read status attributes from a response element's opening tag. */
function readStatus(openingTag: string): QbxmlResponseStatus {
  return {
    statusCode: getAttr(openingTag, 'statusCode') ?? '',
    statusSeverity: getAttr(openingTag, 'statusSeverity') ?? '',
    statusMessage: getAttr(openingTag, 'statusMessage') ?? '',
    requestId: getAttr(openingTag, 'requestID') ?? undefined,
  };
}

/** Container sub-blocks to strip from a BillRet before leaf extraction.
 *
 *  Any qbXML container that appears WITHIN a BillRet and contains children
 *  with the same tag names we care about (TxnID, EditSequence, RefNumber)
 *  goes here. Today only LinkedTxn is strictly required — it carries a
 *  nested <TxnID> and <RefNumber>. The others (Ref types) are stripped
 *  defensively for hygiene: they contain ListID/FullName which we don't
 *  read, but a future field addition might collide.
 */
const BILLRET_SUBBLOCKS_TO_STRIP = [
  'LinkedTxn',
  'VendorRef',
  'VendorAddress',
  'APAccountRef',
  'CurrencyRef',
  'TermsRef',
  'SalesTaxCodeRef',
  'ExpenseLineRet',
  'ItemLineRet',
  'ItemGroupLineRet',
  'CustomFieldRet',
  'DataExtRet',
];

/** Sub-blocks to strip from a BillPaymentCheckRet before leaf extraction.
 *
 *  Same reasoning as BILLRET_SUBBLOCKS_TO_STRIP: AppliedToTxnRet blocks
 *  contain nested TxnID (the ID of each bill being paid), which would
 *  collide with the header-level TxnID of the payment itself.
 */
const BILLPAYMENTCHECKRET_SUBBLOCKS_TO_STRIP = [
  'AppliedToTxnRet',
  'PayeeEntityRef',
  'APAccountRef',
  'BankAccountRef',
  'CurrencyRef',
  'CustomFieldRet',
  'DataExtRet',
];

function stripSubBlocks(fragment: string, tags: string[]): string {
  let out = fragment;
  for (const t of tags) out = stripAllOccurrences(out, t);
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Split a QBXML response envelope into individual response element fragments
 *  (e.g. one per BillQueryRs, BillAddRs, BillPaymentCheckAddRs).
 *
 *  Returns each response element as a full string (opening tag + content +
 *  closing tag). The edge fn routes each fragment to the appropriate parser
 *  based on the tag name.
 *
 *  Returns an empty array when the envelope contains no `<*Rs>` elements
 *  (unusual but possible for error responses). */
export function unwrapQbxmlResponses(xml: string): string[] {
  // Find the QBXMLMsgsRs container; its immediate children are the response
  // elements. If missing, return the whole doc — some error paths (e.g. host
  // errors) come as bare fragments without the outer envelope.
  const msgs = getFirstElement(xml, 'QBXMLMsgsRs');
  const scope = msgs ? msgs.inner : xml;
  // Match any element whose tag ends in "Rs" (BillQueryRs, BillAddRs,
  // BillPaymentCheckAddRs, HostQueryRs, CompanyQueryRs, etc.).
  // Ignore attributes; capture the whole element including nested content.
  const pattern = /<([A-Za-z][A-Za-z0-9]*Rs)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
  return scope.match(pattern) ?? [];
}

/** Parse a `<BillQueryRs>` response element.
 *
 *  Zero `<BillRet>` blocks is a valid successful result (statusCode=0 with
 *  no matches, or statusCode=1 "no records found" per QB convention). Both
 *  cases yield `results: []`; distinguish by inspecting `status.statusCode`.
 *
 *  Callers pass in EITHER the bare `<BillQueryRs>` element (from
 *  `unwrapQbxmlResponses`) OR the full envelope — either works.
 */
export function parseBillQueryRs(xml: string): ParsedBillQueryRs {
  const el = getFirstElement(xml, 'BillQueryRs');
  if (!el) {
    return {
      status: { statusCode: '', statusSeverity: '', statusMessage: 'BillQueryRs element not found' },
      results: [],
    };
  }
  const status = readStatus(el.openingTag);
  const results: BillQueryResult[] = [];
  for (const block of getAllBlocks(el.inner, 'BillRet')) {
    const cleaned = stripSubBlocks(block, BILLRET_SUBBLOCKS_TO_STRIP);
    const txnId = getLeafText(cleaned, 'TxnID');
    const editSequence = getLeafText(cleaned, 'EditSequence');
    const refNumber = getLeafText(cleaned, 'RefNumber');
    if (txnId != null && editSequence != null && refNumber != null) {
      results.push({ txnId, editSequence, refNumber });
    }
  }
  return { status, results };
}

/** Parse a `<BillAddRs>` response element.
 *
 *  On success (statusCode=0): exactly one `<BillRet>` block, parsed into
 *  `result`. On error: no `<BillRet>` block; `result` is null and the
 *  caller inspects `status` for the error message.
 */
export function parseBillAddRs(xml: string): ParsedBillAddRs {
  const el = getFirstElement(xml, 'BillAddRs');
  if (!el) {
    return {
      status: { statusCode: '', statusSeverity: '', statusMessage: 'BillAddRs element not found' },
      result: null,
    };
  }
  const status = readStatus(el.openingTag);
  const blocks = getAllBlocks(el.inner, 'BillRet');
  if (blocks.length === 0) return { status, result: null };
  const cleaned = stripSubBlocks(blocks[0], BILLRET_SUBBLOCKS_TO_STRIP);
  const txnId = getLeafText(cleaned, 'TxnID');
  const editSequence = getLeafText(cleaned, 'EditSequence');
  const refNumber = getLeafText(cleaned, 'RefNumber');
  if (txnId == null || editSequence == null || refNumber == null) {
    return { status, result: null };
  }
  const out: BillAddResult = { txnId, editSequence, refNumber };
  return { status, result: out };
}

/** Parse a `<BillPaymentCheckAddRs>` response element.
 *
 *  RefNumber is optional on the request; when absent it will also be absent
 *  on the response Ret block. `result.refNumber` is therefore optional too. */
export function parseBillPaymentCheckAddRs(
  xml: string,
): ParsedBillPaymentCheckAddRs {
  const el = getFirstElement(xml, 'BillPaymentCheckAddRs');
  if (!el) {
    return {
      status: {
        statusCode: '',
        statusSeverity: '',
        statusMessage: 'BillPaymentCheckAddRs element not found',
      },
      result: null,
    };
  }
  const status = readStatus(el.openingTag);
  const blocks = getAllBlocks(el.inner, 'BillPaymentCheckRet');
  if (blocks.length === 0) return { status, result: null };
  const cleaned = stripSubBlocks(
    blocks[0],
    BILLPAYMENTCHECKRET_SUBBLOCKS_TO_STRIP,
  );
  const txnId = getLeafText(cleaned, 'TxnID');
  const editSequence = getLeafText(cleaned, 'EditSequence');
  const refNumber = getLeafText(cleaned, 'RefNumber');
  if (txnId == null || editSequence == null) {
    return { status, result: null };
  }
  const out: BillPaymentCheckAddResult = {
    txnId,
    editSequence,
    ...(refNumber != null && refNumber !== '' ? { refNumber } : {}),
  };
  return { status, result: out };
}
