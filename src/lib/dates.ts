// Pure date helpers extracted from TimesheetSystem.tsx.
//
// parseLocalDate is critical: splits on '-' rather than using new Date(str)
// so that 'YYYY-MM-DD' strings are interpreted as LOCAL dates, not UTC.
// See CLAUDE.md "Timezone handling" — always prefer this over new Date(dateString).

export function parseLocalDate(dateStr: string): Date {
  // Handle full ISO strings like '2026-02-23T00:00:00.000Z' by taking just the date part
  const clean = dateStr.split('T')[0];
  const [y, m, d] = clean.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function getWeekDates(startDate: Date): Date[] {
  // startDate is Monday; returns Mon–Sun (7 days).
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    date.setHours(0, 0, 0, 0);
    dates.push(date);
  }
  return dates;
}
