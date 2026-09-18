// IBAN is spec-defined as ASCII alphanumerics only. PDF text extraction can inject
// non-breaking spaces / zero-width joiners that pass visual inspection but corrupt
// the paste target. Strip aggressively; upper-case for consistency.
export function sanitizeIban(s: string): string {
  return (s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// Best-effort ASCII transliteration for Convera Short Name suggestions. SWIFT MT103
// field 59 uses the `x` character set which excludes Croatian/Bosnian diacritics —
// correspondent banks strip them anyway on the international leg — and existing
// Convera short names in our data are already ASCII (accountant convention). Long
// Name is left untouched: it should match the beneficiary's legal registered name.
// Combining diacritics (Š, Ž, Č, Ć, á, é, …) fall to NFD-strip. Distinct letters
// that aren't combining chars (Đ, Ł, Ø, ß, Æ, Œ, Þ) need an explicit map.
export function transliterateAscii(s: string): string {
  const LETTER_MAP: Record<string, string> = {
    'Đ': 'D', 'đ': 'd',
    'Ł': 'L', 'ł': 'l',
    'Ø': 'O', 'ø': 'o',
    'ß': 'ss',
    'Þ': 'Th', 'þ': 'th',
    'Æ': 'AE', 'æ': 'ae',
    'Œ': 'OE', 'œ': 'oe',
  };
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split('').map(c => LETTER_MAP[c] ?? c).join('');
}

// ISO 13616 mod-97 IBAN checksum. Same implementation as scripts/invoice-parser/parser.js
// and supabase/functions/ingest-invoice/index.ts.
export function ibanChecksumValid(iban: string): boolean {
  const s = sanitizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s) || s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, c => (c.charCodeAt(0) - 55).toString());
  let r = 0;
  for (const d of numeric) r = (r * 10 + parseInt(d, 10)) % 97;
  return r === 1;
}

// Expected IBAN length by country prefix, limited to the countries our contractors use.
// If the stored IBAN's length doesn't match, we surface a warning in the Create-Beneficiary
// panel — the underlying profile is broken and pasting it into Convera will fail silently.
export const IBAN_LENGTH_BY_COUNTRY: Record<string, number> = {
  HR: 21, BA: 20, RS: 22, SI: 19, MK: 19, ME: 22,
  GB: 22, IE: 22, DE: 22, FR: 27, NL: 18, ES: 24, IT: 27, PT: 25,
  CH: 21, AT: 20, BE: 16, PL: 28, RO: 24, BG: 22, HU: 28, CZ: 24, SK: 24,
};

export function checkIbanLength(iban: string): { ok: boolean; actual: number; expected: number | null } {
  const clean = sanitizeIban(iban);
  const cc = clean.slice(0, 2).toUpperCase();
  const expected = IBAN_LENGTH_BY_COUNTRY[cc] ?? null;
  return { ok: expected == null || clean.length === expected, actual: clean.length, expected };
}
