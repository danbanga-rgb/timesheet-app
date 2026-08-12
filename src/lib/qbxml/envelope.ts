// QBXML envelope helpers.
//
// Every qbXML round-trip is wrapped in a <?xml + <?qbxml + <QBXML><QBXMLMsgsRq>
// envelope. Splitting envelope from request builders lets the edge fn
// eventually batch multiple requests in one round-trip (which the Web
// Connector supports — it sends the whole envelope to QB in one hop).

/** qbXML spec version targeted for QB Desktop 2020 Pro compat.
 *  See GOTCHAS.md for the version-selection rationale. */
export const QBXML_VERSION = '13.0';

/** Wrap one or more qbXML request elements in a full QBXML envelope. */
export function wrapQbxmlRequests(
  requestElements: string[],
  opts: { onError?: 'stopOnError' | 'continueOnError' } = {},
): string {
  const onError = opts.onError ?? 'stopOnError';
  const body = requestElements.join('\n    ');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<?qbxml version="${QBXML_VERSION}"?>`,
    '<QBXML>',
    `  <QBXMLMsgsRq onError="${onError}">`,
    `    ${body}`,
    '  </QBXMLMsgsRq>',
    '</QBXML>',
  ].join('\n');
}

/** Escape a string for safe inclusion in XML text or attributes. Only the five
 *  XML special chars. All builder inputs are validated as printable-ASCII by
 *  assertAscii() before reaching xmlEscape — see the ASCII-only rule below. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ASCII-only enforcement for qbXML builder inputs.
 *
 *  Rule: every string that leaves the builder as qbXML MUST be printable ASCII
 *  (0x20–0x7E, plus tab/newline). Rationale: QB Desktop's Xerces parser ignores
 *  our <?xml encoding="utf-8"?> declaration and decodes the byte stream as
 *  Windows-1252. UTF-8 multi-byte sequences then raise
 *  `UTFDataFormatException: invalid byte N of a K-byte sequence` (observed
 *  2026-08-12 live test). Numeric character references work but leak encoding
 *  concerns into every field.
 *
 *  Cleaner rule: normalise vendor/memo/refNumber to ASCII at the source. When a
 *  non-ASCII input reaches the builder, throw with a specific field label so
 *  the caller can strip the diacritics (or, for QB vendor names, arrange with
 *  the accountant to rename the QB entry).
 *
 *  Convention followed for existing Croatian/Serbian/Estonian data:
 *   - Diacritics stripped: č/Č → c/C, ć/Ć → c/C, š/Š → s/S, ž/Ž → z/Z, đ/Đ → d/D
 *   - Estonian OÜ → OU (private-limited suffix)
 *   - Em-dash — → space-hyphen-space (' - ')
 */
export function assertAscii(fieldName: string, value: string): void {
  if (value == null) return;  // optional fields handled by caller check
  const bad = value.match(/[^\x09\x0A\x0D\x20-\x7E]/);
  if (bad) {
    const codePoint = bad[0].codePointAt(0)!.toString(16).padStart(4, '0');
    throw new Error(
      `qbxml: '${fieldName}' contains non-ASCII character '${bad[0]}' (U+${codePoint.toUpperCase()}) ` +
      `at index ${bad.index}: '${value}'. ` +
      `QB Desktop rejects non-ASCII via Xerces UTFDataFormatException. ` +
      `Normalise to ASCII at the source (strip diacritics, or rename the QB entry).`,
    );
  }
}
