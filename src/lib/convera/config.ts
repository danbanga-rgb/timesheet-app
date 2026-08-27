// convera adapter — source-specific config.
//
// Kept in code (not DB) per [[qb-automation-architecture]] simplification —
// edit + commit + deploy to bump. When accountant validates a new month,
// nudge the cutoff forward here.

/**
 * Invoices with period_end < this cutoff are pre-our-system for the Convera
 * path: QB and Convera were reconciled manually before we existed here.
 * G7.6 proactive create_bill short-circuits below this date to avoid pushing
 * bills for months already reconciled outside our system.
 *
 * Set 2026-08-26 to match the IIF/matcher cutoff used elsewhere for Convera
 * (see [[matcher-ignore]] invoices cutoff 2026-04-28).
 */
export const CONVERA_PRE_OUR_SYSTEM_CUTOFF = '2026-04-28';
