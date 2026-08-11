// SOAP wire helpers for qb-web-connector. Pure — no Deno.env, no I/O.
//
// QBWC uses SOAP 1.1 with predictable envelope shapes: a namespace-prefixed
// <Body> wraps a single method-call element whose xmlns is the Intuit
// namespace. Params are direct children. Response echoes back a
// <methodResponse><methodResult>...</methodResult></methodResponse> body.
//
// Extracted from index.ts so we can Vitest-test the wire format without
// pulling in Deno's serve() or supabase-js.

const NS_INTUIT = 'http://developer.intuit.com/';

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parse a QBWC SOAP request. Returns the method name (e.g. "authenticate")
 *  and each named child element of the method call as a string param.
 *  Returns null if the envelope shape doesn't match. */
export function parseSoapRequest(
  xml: string,
): { method: string; params: Record<string, string> } | null {
  // Body element with any 1..8-char namespace prefix
  const bodyMatch = xml.match(
    /<[A-Za-z][A-Za-z0-9]*:Body[^>]*>([\s\S]*?)<\/[A-Za-z][A-Za-z0-9]*:Body>/,
  );
  if (!bodyMatch) return null;
  const body = bodyMatch[1];
  // Method call — unprefixed name, with (default xmlns) attribute
  const methodMatch = body.match(
    /<([A-Za-z][A-Za-z0-9]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/,
  );
  if (!methodMatch) return null;
  const method = methodMatch[1];
  const inner = methodMatch[2];
  const params: Record<string, string> = {};
  const paramRe = /<([A-Za-z][A-Za-z0-9]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(inner)) !== null) {
    params[m[1]] = xmlUnescape(m[2]);
  }
  return { method, params };
}

/** Build a QBWC SOAP response envelope for a method.
 *  `resultBody` is the raw XML that goes INSIDE `<methodResult>...</methodResult>`.
 *  For plain strings, escape and pass in. For arrays of strings (e.g.
 *  authenticate returns [ticket, companyFile]), pass
 *  `<string>a</string><string>b</string>`. */
export function buildSoapResponse(method: string, resultBody: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <soap:Body>',
    `    <${method}Response xmlns="${NS_INTUIT}">`,
    `      <${method}Result>${resultBody}</${method}Result>`,
    `    </${method}Response>`,
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join('\n');
}

export function buildSoapFault(faultString: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    '  <soap:Body>',
    '    <soap:Fault>',
    '      <faultcode>soap:Server</faultcode>',
    `      <faultstring>${xmlEscape(faultString)}</faultstring>`,
    '    </soap:Fault>',
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join('\n');
}
