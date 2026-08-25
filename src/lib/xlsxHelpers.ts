// Cross-parser XLSX utilities. Used by any loader that reads QuickBooks /
// Intuit / bank exports where dates arrive as Excel serial numbers or
// formatted strings, and where deterministic content hashes are needed for
// idempotent upserts (source_ref on qb_ingest_events, etc.).

/** Excel date cell → YYYY-MM-DD ISO date string.
 *
 *  SheetJS returns date-typed cells as their numeric serial (days since
 *  1900-01-01) by default. Some exports also return dates as pre-formatted
 *  strings ("01/14/2026" or "2026-01-14"). This helper handles all three,
 *  and returns an empty string if the cell isn't a parseable date.
 *
 *  MM/DD vs DD/MM disambiguation: if the first token > 12 it must be a day,
 *  so we treat as DD/MM/YYYY. Otherwise assume American MM/DD/YYYY (the QB
 *  and Intuit exports we handle are all US-locale). */
export function excelDateToIso(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    return parseInt(a) > 12
      ? `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
      : `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }
  return '';
}

/** SHA-256 of the input as a lowercase hex string. Uses the WebCrypto Subtle
 *  API — available in modern browsers and Node 20+. Used to derive
 *  deterministic source_ref values for idempotent upserts. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
