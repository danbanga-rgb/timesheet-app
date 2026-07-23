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

/** Escape a string for safe inclusion in XML text or attributes. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
