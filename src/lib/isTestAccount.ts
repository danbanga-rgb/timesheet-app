// Recognizes internal test accounts by name pattern (name === 'test' or
// contains hotmail/yahoo as a word). Used to exclude test users from
// consolidated reports, weekly reminders, and CSV exports.
//
// NOTE: a divergent sibling still lives inline in TimesheetSystem.tsx as
// `isTestName` (missing the `.trim()`). That's a separate slice — see the
// TODO comment near its definition.

export function isTestAccount(name: string): boolean {
  const l = (name || '').toLowerCase().trim();
  return l === 'test' || /\b(hotmail|yahoo)\b/.test(l);
}
