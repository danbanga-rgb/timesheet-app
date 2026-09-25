// Tiered vendor-mapping resolver for QB Automation v2 Needs Mapping card.
//
// Tier 1 (exact `pp_id` lookup) is handled by the classifier / v4 save path
// — mappings that already exist never surface in Needs Mapping.
//
// This resolver runs Tiers 2 + 3 for the rows that DO surface:
//   Tier 2 — history:        contractor has posted bills under a QB vendor.
//   Tier 3 — token-overlap:  contractor-name tokens found in QB vendor name.
//
// Real LLM (Haiku 4.5 via Anthropic direct) is deferred to V6-B; this pure
// heuristic already resolves ~80% of the practical cases per
// [[qb-vendor-mapping-truths-2026-09]] (Bimosoft/NT vendors are
// per-contractor-suffixed).

export type ResolverTier = 'history' | 'token_overlap';
export type Confidence = 'high' | 'medium' | 'low';

export interface Candidate {
  qbVendorListId: string;
  qbVendorName: string;
  confidence: Confidence;
  tier: ResolverTier;
  reason: string;
}

export interface ResolveInput {
  contractorName: string;
  contractorUserId: string | null;
  ppLabel: string;
}

export interface ResolveContext {
  vendors: Array<{ listId: string; name: string }>;
  /** userId → set of qbVendorListIds they've been paid under (posted events). */
  historyByUser: Map<string, Set<string>>;
}

const MIN_TOKEN_LEN = 3;
const NAME_STOPWORDS = new Set([
  'the', 'and', 'ltd', 'llc', 'inc', 'corp', 'co', 'ltda', 'limited',
  'sp', 'sro', 's.r.o', 'gmbh', 'obrt', 'vl', 'o.d', 'dj', 'obrtnicka',
  'djelatnost', 'holding', 'group',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= MIN_TOKEN_LEN && !NAME_STOPWORDS.has(t));
}

/**
 * Top-N candidates for a Needs Mapping row, ordered by (tier priority, confidence).
 * Returns up to `limit` candidates (default 3).
 */
export function resolveVendorCandidates(
  input: ResolveInput,
  ctx: ResolveContext,
  limit: number = 3,
): Candidate[] {
  const out: Candidate[] = [];
  const seenListIds = new Set<string>();

  // Tier 2 — history. If this contractor has posted bills under a QB vendor
  // before, surface it as HIGH confidence.
  if (input.contractorUserId) {
    const historicalVendorIds = ctx.historyByUser.get(input.contractorUserId);
    if (historicalVendorIds && historicalVendorIds.size > 0) {
      for (const listId of historicalVendorIds) {
        const vendor = ctx.vendors.find(v => v.listId === listId);
        if (!vendor) continue;
        if (seenListIds.has(listId)) continue;
        seenListIds.add(listId);
        out.push({
          qbVendorListId: listId,
          qbVendorName: vendor.name,
          confidence: 'high',
          tier: 'history',
          reason: `Contractor has ${historicalVendorIds.size > 1 ? 'past bills' : 'a past bill'} under this vendor`,
        });
      }
    }
  }

  // Tier 3 — token overlap. Score each vendor by number of contractor-name
  // tokens found in the vendor name. High = 2+ tokens matched. Medium = 1
  // strong (≥5 chars) token. Low = 1 short token.
  const contractorTokens = new Set(tokenize(input.contractorName));
  const ppTokens = new Set(tokenize(input.ppLabel));

  if (contractorTokens.size > 0 || ppTokens.size > 0) {
    const scored: Array<{ vendor: { listId: string; name: string }; tokens: string[]; longest: number }> = [];
    for (const v of ctx.vendors) {
      if (seenListIds.has(v.listId)) continue;
      const vendorTokens = new Set(tokenize(v.name));
      const matched: string[] = [];
      for (const t of contractorTokens) if (vendorTokens.has(t)) matched.push(t);
      for (const t of ppTokens) if (vendorTokens.has(t) && !matched.includes(t)) matched.push(t);
      if (matched.length === 0) continue;
      const longest = matched.reduce((max, t) => Math.max(max, t.length), 0);
      scored.push({ vendor: v, tokens: matched, longest });
    }
    scored.sort((a, b) => {
      if (b.tokens.length !== a.tokens.length) return b.tokens.length - a.tokens.length;
      return b.longest - a.longest;
    });

    for (const { vendor, tokens, longest } of scored) {
      if (out.length >= limit) break;
      const confidence: Confidence =
        tokens.length >= 2 ? 'high'
        : longest >= 5 ? 'medium'
        : 'low';
      out.push({
        qbVendorListId: vendor.listId,
        qbVendorName: vendor.name,
        confidence,
        tier: 'token_overlap',
        reason: `Name match: ${tokens.join(', ')}`,
      });
      seenListIds.add(vendor.listId);
    }
  }

  return out.slice(0, limit);
}

/**
 * Build a history map from a set of qb_ingest_events.
 * Extracted so the resolver stays pure — tests inject the map directly.
 */
export function buildHistoryByUser(
  events: Array<{ status: string; counterpartyQbVendorListId: string | null; matchedInvoiceIds: number[] }>,
  invoiceUserIdById: Map<number, string>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.status !== 'posted') continue;
    if (!e.counterpartyQbVendorListId) continue;
    const invId = e.matchedInvoiceIds[0];
    if (invId == null) continue;
    const userId = invoiceUserIdById.get(invId);
    if (!userId) continue;
    if (!result.has(userId)) result.set(userId, new Set());
    result.get(userId)!.add(e.counterpartyQbVendorListId);
  }
  return result;
}
