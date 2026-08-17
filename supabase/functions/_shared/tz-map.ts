// Country/region → IANA timezone. Single source of truth used by both the frontend
// (src/TimesheetSystem.tsx re-exports) and edge functions (send-reminder).
//
// Lookup pattern: tzMap[`${country}-${region}`] || tzMap[`${country}-`] || fallback.
// Empty-region keys ('BA-', 'HR-', etc.) cover contractors whose region hasn't been
// filled — reminder scheduling still fires in local time.

export const tzMap: Record<string, string> = {
  'US-California': 'America/Los_Angeles', 'US-New York': 'America/New_York',
  'US-Texas': 'America/Chicago', 'US-Florida': 'America/New_York',
  'GB-England': 'Europe/London', 'GB-Scotland': 'Europe/London', 'GB-Wales': 'Europe/London',
  'CA-Ontario': 'America/Toronto', 'CA-Quebec': 'America/Toronto', 'CA-British Columbia': 'America/Vancouver',
  'HR-': 'Europe/Zagreb', 'RS-': 'Europe/Belgrade', 'BA-': 'Europe/Sarajevo',
  'SI-': 'Europe/Ljubljana', 'MK-': 'Europe/Skopje',
  'HR-Croatia': 'Europe/Zagreb', 'RS-Serbia': 'Europe/Belgrade',
  'BA-Bosnia and Herzegovina': 'Europe/Sarajevo', 'SI-Slovenia': 'Europe/Ljubljana',
  'MK-North Macedonia': 'Europe/Skopje',
  'IN-': 'Asia/Kolkata',
  'NL-': 'Europe/Amsterdam',
  'AM-': 'Asia/Yerevan',
};

export function lookupTimezone(country: string, region: string, fallback = 'America/New_York'): string {
  return tzMap[`${country}-${region}`] || tzMap[`${country}-`] || fallback;
}
