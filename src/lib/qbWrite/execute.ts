// qbWrite/execute — the atomic-intent executor. Turns a list of validated
// intents into qb_sync_jobs rows. QBWC drains those on its poll cycle.
//
// READ src/lib/qbWrite/INVARIANTS.md BEFORE MODIFYING THIS FILE.
// This module is the ONE PLACE all battle-tested QB write rules are enforced.
// Every rule regression here is a real-money bug — see prior incidents cited
// in INVARIANTS.md.
//
// This is a SCAFFOLD (Slice G6 Part 1). validateIntent and executeIntents
// return safe empty results; concrete rule implementations land in subsequent
// commits with their corresponding it.todo tests un-skipped one at a time.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExecuteResult, WriteIntent } from './types';

type SB = SupabaseClient;

/** Validate a single intent against every applicable invariant in INVARIANTS.md.
 *  Returns null on pass, or a { reason, invariant } object on fail.
 *
 *  SCAFFOLD — implementations land per-commit alongside their un-skipped tests. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validateIntent(_intent: WriteIntent): { reason: string; invariant: string } | null {
  return null;
}

/** Enqueue a batch of intents. Validates each; skips duplicates; inserts
 *  the rest into qb_sync_jobs. Returns per-intent status.
 *
 *  SCAFFOLD — validate/dedup/enqueue land per-commit. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function executeIntents(_supabase: SB, intents: WriteIntent[]): Promise<ExecuteResult> {
  return {
    jobIds: intents.map(() => null),
    rejected: [],
    skippedDuplicate: [],
  };
}
