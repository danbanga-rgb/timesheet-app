import { parseLocalDate } from './dates';

// NET15/30/45/60 → periodEnd + N days → snap forward to next 15th/EOM payment
// run, then push weekend-landing runs back to Fri / forward to Mon.
export function calculatePayOn(periodEnd: string, terms: string): string {
  const daysMap: Record<string, number> = { NET15: 15, NET30: 30, NET45: 45, NET60: 60 };
  const n = daysMap[terms];
  if (!n || !periodEnd) return '';
  const due = parseLocalDate(periodEnd);
  due.setDate(due.getDate() + n);
  let payRun: Date | null = null;
  for (let mo = 0; mo <= 3 && !payRun; mo++) {
    const y = due.getFullYear() + Math.floor((due.getMonth() + mo) / 12);
    const m = (due.getMonth() + mo) % 12;
    for (const candidate of [new Date(y, m, 15), new Date(y, m + 1, 0)]) {
      if (candidate >= due) { payRun = candidate; break; }
    }
  }
  if (!payRun) return '';
  const dow = payRun.getDay();
  if (dow === 6) payRun.setDate(payRun.getDate() - 1);
  if (dow === 0) payRun.setDate(payRun.getDate() + 1);
  return `${payRun.getFullYear()}-${String(payRun.getMonth() + 1).padStart(2, '0')}-${String(payRun.getDate()).padStart(2, '0')}`;
}
