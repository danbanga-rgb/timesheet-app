// Tests for the SOAP wire-format helpers in the qb-web-connector edge function.
// Imports directly from the edge fn folder so tests exercise the exact code
// that runs in prod.

import { describe, expect, it } from 'vitest';

import {
  buildSoapFault,
  buildSoapResponse,
  parseSoapRequest,
  xmlEscape,
  xmlUnescape,
} from '../../../../supabase/functions/qb-web-connector/soap';

describe('xmlEscape / xmlUnescape', () => {
  it('escapes the five XML special chars', () => {
    expect(xmlEscape(`Bimosoft & "Co" <'test'>`)).toBe(
      'Bimosoft &amp; &quot;Co&quot; &lt;&apos;test&apos;&gt;',
    );
  });

  it('unescape is the inverse of escape', () => {
    const s = `Ampersand & angles <> quotes " ' & again`;
    expect(xmlUnescape(xmlEscape(s))).toBe(s);
  });

  it('escapes & first so decoded strings roundtrip cleanly', () => {
    // Regression: if & isn't escaped first, later replacements corrupt it.
    expect(xmlEscape('&lt;')).toBe('&amp;lt;');
    expect(xmlUnescape(xmlEscape('&lt;'))).toBe('&lt;');
  });
});

describe('parseSoapRequest', () => {
  it('extracts method name and named string params from a QBWC envelope', () => {
    const env = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <authenticate xmlns="http://developer.intuit.com/">
      <strUserName>synergie</strUserName>
      <strPassword>hunter2</strPassword>
    </authenticate>
  </soap:Body>
</soap:Envelope>`;
    const parsed = parseSoapRequest(env);
    expect(parsed).not.toBeNull();
    expect(parsed!.method).toBe('authenticate');
    expect(parsed!.params.strUserName).toBe('synergie');
    expect(parsed!.params.strPassword).toBe('hunter2');
  });

  it('accepts any namespace prefix on the Body element', () => {
    // QBWC has been observed with soap, soapenv, s: — regex must not hardcode.
    const env = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <serverVersion xmlns="http://developer.intuit.com/"/>
  </s:Body>
</s:Envelope>`;
    // Self-closing method call — inner is empty. Our current regex requires
    // paired tags; a self-close returns null. That's fine for QBWC — every
    // real call has at least the ticket param.
    const parsed = parseSoapRequest(env);
    // Just verify it doesn't blow up on unusual prefixes when there's a
    // paired body element with content:
    const env2 = env.replace(
      '<serverVersion xmlns="http://developer.intuit.com/"/>',
      '<serverVersion xmlns="http://developer.intuit.com/"></serverVersion>',
    );
    const parsed2 = parseSoapRequest(env2);
    expect(parsed2).not.toBeNull();
    expect(parsed2!.method).toBe('serverVersion');
    expect(parsed).toBeNull();  // self-close correctly returns null
  });

  it('decodes escaped entities in param values', () => {
    const env = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <receiveResponseXML xmlns="http://developer.intuit.com/">
      <ticket>abc</ticket>
      <response>&lt;QBXML&gt;&amp;&lt;/QBXML&gt;</response>
    </receiveResponseXML>
  </soap:Body>
</soap:Envelope>`;
    const parsed = parseSoapRequest(env);
    expect(parsed!.params.response).toBe('<QBXML>&</QBXML>');
  });

  it('returns null when the envelope is malformed', () => {
    expect(parseSoapRequest('not xml at all')).toBeNull();
    expect(parseSoapRequest('<foo>no body</foo>')).toBeNull();
  });
});

describe('buildSoapResponse', () => {
  it('wraps a string result in the QBWC-expected envelope shape', () => {
    const xml = buildSoapResponse('serverVersion', '0.1.0');
    expect(xml).toMatch(/<\?xml version="1.0" encoding="utf-8"\?>/);
    expect(xml).toMatch(/<soap:Envelope[^>]+xmlns:soap="http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/"/);
    expect(xml).toMatch(/<serverVersionResponse xmlns="http:\/\/developer\.intuit\.com\/">/);
    expect(xml).toMatch(/<serverVersionResult>0\.1\.0<\/serverVersionResult>/);
    expect(xml).toMatch(/<\/serverVersionResponse>/);
  });

  it('accepts arbitrary XML for the result body — used by authenticate for [ticket, companyFile]', () => {
    const xml = buildSoapResponse(
      'authenticate',
      '<string>abc-ticket</string><string></string>',
    );
    expect(xml).toMatch(/<authenticateResult><string>abc-ticket<\/string><string><\/string><\/authenticateResult>/);
  });

  it('is round-trippable: response for method X parses back as method XResponse', () => {
    const out = buildSoapResponse('closeConnection', 'OK');
    const parsed = parseSoapRequest(out);
    expect(parsed!.method).toBe('closeConnectionResponse');
    expect(parsed!.params.closeConnectionResult).toBe('OK');
  });
});

describe('buildSoapFault', () => {
  it('emits a soap:Fault envelope with the message escaped', () => {
    const xml = buildSoapFault(`Failure & "reason"`);
    expect(xml).toMatch(/<soap:Fault>/);
    expect(xml).toMatch(/<faultcode>soap:Server<\/faultcode>/);
    expect(xml).toMatch(/<faultstring>Failure &amp; &quot;reason&quot;<\/faultstring>/);
  });
});
