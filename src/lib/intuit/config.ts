// intuit adapter — source-specific config.
//
// Kept in code (not DB) per [[qb-automation-architecture]] simplification —
// edit + commit + deploy to bump. When accountant validates a new month,
// nudge the cutoff forward here.

/**
 * Events with txn_date < this cutoff are considered pre-our-system: QB was
 * managed manually (accountant + prior tooling) before we existed for this
 * source. Reconciler short-circuits them to resolved_action='pre_our_system'
 * — no push, no auto-close-via-mirror, just "leave QB's history alone."
 *
 * Bumped as accountant validates months. Current: 2026-06-01 covers June
 * onward as our confidence window. Older events (Jan-May 2026 Intuit) are
 * historical.
 */
export const INTUIT_PRE_OUR_SYSTEM_CUTOFF = '2026-06-01';
