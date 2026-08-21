// INVARIANTS #31 — two-copy qbxml/ drift enforcement.
//
// Deno edge functions can't import from `src/lib/`, so the same qbxml module
// lives in two places:
//   src/lib/qbxml/                                — Node/TS/Vite side
//   supabase/functions/qb-web-connector/qbxml/    — Deno edge fn side
//
// Any parser / builder / types / payload change must be applied to BOTH.
// This bit us multiple times (most recently Slice G1, 2026-08-20). This test
// diffs the two directories and fails on divergence. The only legitimate
// difference is import extensions — Deno requires `.ts`, Node forbids it — so
// we normalize import paths before comparing.
//
// If this test fails: the fix is to sync the file, not weaken the test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NODE_DIR = join(__dirname, '..');
const DENO_DIR = join(__dirname, '..', '..', '..', '..', 'supabase', 'functions', 'qb-web-connector', 'qbxml');

// Files that must be byte-equivalent (after import-extension normalization).
// README / GOTCHAS are docs — not code; leave out.
const FILES = ['builders.ts', 'constants.ts', 'envelope.ts', 'job-payloads.ts', 'parsers.ts', 'types.ts'];

// Normalize: strip `.ts` from relative imports so Node and Deno forms compare equal.
//   Deno:  import { x } from './envelope.ts';
//   Node:  import { x } from './envelope';
function normalize(src: string): string {
  return src.replace(/from\s+(['"])(\.\/[^'"]+?)\.ts\1/g, 'from $1$2$1');
}

describe('qbxml two-copy drift (INVARIANTS #31)', () => {
  for (const file of FILES) {
    it(`${file} is identical (modulo .ts import suffix) between src/lib/qbxml/ and supabase/functions/qb-web-connector/qbxml/`, () => {
      const nodeSrc = normalize(readFileSync(join(NODE_DIR, file), 'utf8'));
      const denoSrc = normalize(readFileSync(join(DENO_DIR, file), 'utf8'));
      // Give a helpful message on failure: show the first differing line
      // so the fix is obvious.
      if (nodeSrc !== denoSrc) {
        const nl = nodeSrc.split('\n');
        const dl = denoSrc.split('\n');
        const firstDiff = (() => {
          const max = Math.max(nl.length, dl.length);
          for (let i = 0; i < max; i++) {
            if (nl[i] !== dl[i]) return i;
          }
          return -1;
        })();
        const context = firstDiff >= 0
          ? `\nFirst differing line ${firstDiff + 1}:\n  node: ${JSON.stringify(nl[firstDiff])}\n  deno: ${JSON.stringify(dl[firstDiff])}`
          : `\n(lengths differ: node=${nl.length} lines, deno=${dl.length} lines)`;
        throw new Error(
          `qbxml drift detected in ${file}. Copy the change to both:\n` +
          `  src/lib/qbxml/${file}\n` +
          `  supabase/functions/qb-web-connector/qbxml/${file}` +
          context,
        );
      }
      expect(nodeSrc).toEqual(denoSrc);
    });
  }
});
