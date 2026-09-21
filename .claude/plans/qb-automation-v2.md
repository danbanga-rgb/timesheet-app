# QB Automation v2 — Ground-up Rebuild

**Started:** 2026-09-18 (S7, immediately after Accountant modularization arc reached STOP GATE post-IB).
**Status:** SPEC LOCKED S8 (2026-09-21). §5 populated. §9 slice roadmap added for multi-session pickup. Code work begins with Slice V1 next session.
**Supersedes:** Accountant modularization Chunk 8 (X4 + QA1–QA9) — see [[qb-automation-v2-pivot]].

---

## §0. Fast Start (read this first on cold start)

**If you're resuming this arc from a cold session, read in this order:**

1. **This file §1 (Locked decisions), §2 (Spec flow), §4 (Reuse manifest), §5 (Sections + flows), §6 (Non-goals), §9 (Slice roadmap).** §5 is now populated (S8).
2. Memory [[qb-automation-v2-pivot]] — origin decision + S8 locked spec decisions.
3. Memory [[qb-vendor-mapping-truths-2026-09]] — empirical baseline (pp is 1:1 with contractor; Teal only true umbrella; zero drift from our pushes).
4. Memory [[accountant-modularization-s4]] — arc-state context for the parent modularization (paused).
5. Memory [[qb-automation-ux-contract]] — v1's 6 UX rules (some carry, some amend in v2).
6. Memory [[umbrella-payment-patterns]] — Native Teams / TCode / Bimosoft / Teal semantics (wire-side aggregation, distinct from QB-side per-contractor naming — see [[qb-vendor-mapping-truths-2026-09]]).

**State on entry:**
- v1 QB Automation tab in `TimesheetSystem.tsx` is FROZEN. Do not touch its render surface.
- v2 code path does NOT EXIST YET. `src/roles/Accountant/tabs/QbAutomationV2/` is a proposed structure in §3, first materialized in Slice V2.
- **Dan is holding the QB push queue** until Slice V1 (pp_id migration + Buzalko fix) ships. See §5.11.
- Chunk 8 in `.claude/plans/accountant-modularization.md` is marked SUPERSEDED.
- Modularization arc is PAUSED. Do not resume Chunk 9/10/Phase 6 slices unless Dan asks.
- TS.tsx last known: 10,431 lines, tip `fcd9ef7` (plan log). Confirm on entry via `git log --oneline -3`.

**Do NOT:**
- Ask Dan clarifying questions until he signals "ready" or dumps directionality. He said "let me think and give you some directionality and then you start asking questions" (2026-09-18).
- Propose sections, flows, or wireframes before Dan gives directionality. That's the design conversation, not the prep.
- Write ANY v2 code before §5 (Sections + flows) is populated and Dan signs off.
- Touch v1 (any file that renders inside the current QB Automation tab in TS.tsx).
- Resume the accountant modularization arc unless Dan explicitly asks.

**Do FIRST on cold start:**
1. Confirm `git log --oneline -3` shows tip `801b080` or later (main).
2. Confirm `.claude/plans/qb-automation-v2.md` exists (this file) and §5 is still empty.
3. Report state to Dan in one sentence: "v2 arc paused waiting on your directionality dump — ready when you are."
4. Wait.

---

## §1. Locked decisions (2026-09-18)

1. **v1 stays frozen.** Zero touches to the current QB Automation tab in `TimesheetSystem.tsx`. Runs as-is until v2 cutover.
2. **v2 built ground-up** at `src/roles/Accountant/tabs/QbAutomationV2/` (final path TBD in §3). Born-modular from day one: `hooks/`, `components/`, `lib/`, `tests/`. Never lives inside TS.tsx.
3. **v2 gated to admin role.** Dan (admin) sees v2 tab; accountant sees v1. No DB migration, no toggle UI — a role check on the tab render is enough. Natural sandbox for parallel comparison.
4. **v2 reuses aggressively.** Already-extracted cross-role modals (`QbPushPreviewModal`, `QbPushStatusPane`, `VendorDecisionModal`), all wrapper handlers (`loadQbIngestEvents`, `pushConveraCreateBillAndPay`, `saveQbVendorMapping`, `loadQbOpenBills`, `runSyncQbBills`, `runSyncQbVendors`, etc.), all lib fns from the 4-layer plumbing ([[qb-automation-architecture]]). Only render surface + UX chrome + mapping UX is greenfield.
5. **Design language:** QbExport modal's category-card status inspector (Ready / No vendor / Already sent / Skipped / Confirmed) + Skip/Unskip/Confirm per-row. Dan cited this as the shape v2 should feel like.
6. **Cutover flow:** when Dan is happy on preview → flip admin gate off → default to v2 for accountant → delete v1 render + related dead helpers.
7. **North star (overarching, applies to EVERY slice):** the accountant must open v2 and understand it without training. v1 is "a minefield" today; showing it to the accountant made his head spin. Every reuse decision, every label, every layout choice must pass the "readable / understandable / user-friendly" lens BEFORE the "fewer LOC" or "faster" lens. If a reused v1 idiom is a UX regression, we rewrite it — reuse is a tool, not a goal.

## §2. Spec flow (Dan's rule)

- Dan gives **directionality** first (page layout intent, key flows, section list, UX pain points).
- Claude asks **follow-up questions** to fill in gaps.
- Claude writes the **design doc** section-by-section as answers land.
- **No Claude questions until Dan signals ready.**

## §3. Directory structure (proposed — LOCK BEFORE FIRST CODE)

```
src/roles/Accountant/tabs/QbAutomationV2/
  index.tsx                    # tab entry; role gate + composition
  Header.tsx                   # top counter + freshness + QBWC heartbeat + sync buttons
  sections/
    <TBD once §5 sections land>
  cards/
    <card components; QbExport-inspired>
  hooks/
    useQbAutomationV2.ts       # top-level state hook (analog of QA7)
    useQbSyncState.ts          # freshness + heartbeat (analog of QA3)
    <TBD>
  lib/
    (nothing new here — pure fns land in src/lib/qbAutomation/ so v1 can also consume)
  tests/
    <TBD>

src/lib/qbAutomation/          # NEW — shared with v1 if ever needed
  missingBills.ts              # pure fn (was QA1)
  inboxGroups.ts               # pure fn (was QA2)
  <TBD>
```

**Rationale:** anything pure moves to `src/lib/qbAutomation/` so v1 and v2 can both consume during coexistence. Anything role-specific lives in the v2 folder.

## §4. Reuse manifest (inventory of v1 assets v2 pulls in)

**Already-extracted components (import as-is):**
- `<QbPushPreviewModal>` — cross-role, extracted.
- `<QbPushStatusPane>` — cross-role, extracted. Owns "In Progress" pane. UX rule 2 satisfied by keeping this.
- `<VendorDecisionModal>` — cross-role, extracted.
- `<MultiSelectDropdown>`, `<SortableHeader>`, `<AutocompletePicker>`, `<FilterPills>` — shared atoms from Phase 1.

**Wrapper handlers (v2 receives as props from `TimesheetSystem.tsx`, same as v1):**
- Loaders: `loadQbIngestEvents`, `loadQbOpenBills`, `loadQbWcLastSeen`, `loadQbVendorMappings`, `loadQbVendorsAndAccounts`
- Recompute: `runRecomputeButton`
- Sync enqueue: `runSyncQbBills`, `runSyncQbVendors`
- Push orchestration: `pushConveraCreateBillAndPay(supabase, ids)` + per-source pushers
- Mapping CRUD: `saveQbVendorMapping`, `deleteQbVendorMapping`
- Cross-tab: `saveQbVendorName`, `applyClassificationPass`, `applyReconciliationPass`
- Helpers: `snapshotAge`, `humanizeAge`, `sourceLabel(s)`

**Wrapper state read (v2 renders from these; v1 writes to them):**
- `qbIngestEvents`, `qbG75PostedInvoiceIds`, `qbG76PostedInvoiceIds`, `qbIngestLoading`
- `qbOpenBills`
- `qbSyncingBills`, `qbBillQueryPending`, `qbPendingJobDetails`, `qbSyncingVendors`, `qbVendorQueryPending`, `qbWcLastSeen`
- `qbVendorsList`, `qbAccountsList`, `qbVendorMappings`
- `qbVendorEditingId`, `qbVendorEditValue` (cross-consumed with PP tab per T32)
- `qbExportSelectedIds`, `qbExportSnapshot`, `qbExportCategoryFilter` (cross-consumed with Invoices tab per Chunk 6)

**Lib fns (v2 owns; v1 may adopt):**
- `computeMissingBills()` — extract from inline (was QA1 spec).
- `computeQbInboxGroups()` — extract from inline (was QA2 spec).

**Design references (v2 pulls the *language* from, not the code):**
- QbExport modal category cards — Ready / No vendor / Already sent / Skipped / Confirmed.
- Skip/Unskip/Confirm per-row action pattern.

## §5. Sections + flows (LOCKED S8 2026-09-21)

Overarching lens (from §1 decision #7): **readable / understandable / user-friendly first.** Every subsection below is subject to that lens.

### §5.1 Landing view anatomy

Admin opens the tab and sees, top-to-bottom:

1. **Header row** — small, unobtrusive:
   - Left: tab title ("QB Automation").
   - Center: freshness pills (three chips): `Mirror ✓ 3m ago` · `Vendors ✓ 8m ago` · `QBWC 🟢 active`. Chips are clickable → force sync (§5.9).
   - Right: manual sync buttons (`Sync Vendors`, `Sync Mirror`) — small, secondary. Same buttons v1 has.

2. **KPI strip** — big, single row, 4 numbers:
   - **Ready to Push: 5 · $12,400**  (primary — bold + green tint)
   - **Needs Mapping: 3**  (amber if > 0)
   - **Skipped: 1**  (grey)
   - **Pushed today: 12 · $18,600**  (grey)
   
   These are the KPIs. Numbers are click-to-jump to that card. That's it — no other summary chrome.

3. **Category cards** in order: Ready → Needs Mapping → Skipped → Pushed today.  Each card is collapsible; Ready is expanded by default; others collapsed by default (expand on click OR when its KPI is clicked).

4. **Live push status pane** (`<QbPushStatusPane>`) — hidden until a push is in flight; slides in from the right or docks at the bottom while a push is happening. Same behavior as v1 but wired into v2's push flow.

5. **Footer link:** "Vendor Mapping →" (opens sub-tab §5.6).

No other panels on the main tab. No Missing QB Bills panel (folded — the answer is "Ready to Push"). No inbox groups panel. No open bills panel. Everything the accountant needs is on this page.

### §5.2 Ready card

**Purpose:** every approved invoice that CAN push right now — plumbing is confident, no unresolved discrepancies (or discrepancy-flagged but user has verified).

**Row anatomy (one line, hover for more):**

```
[✓] Anela Kaltak · INV-1042 · $2,400 · Sep 2026 · → Native Team Anela  [Will Create+Pay]
```

Fields left to right:
- Checkbox (default checked unless discrepancy-flagged).
- Contractor name (primary identity).
- Invoice number.
- Amount.
- Month (source period, not push date).
- Arrow + resolved QB Vendor (mapped, click-to-edit).
- Verdict chip:
  - **Will Create+Pay** — no bill exists in mirror; will `bill_add` then `bill_pmt_add`.
  - **Will Pay** — bill exists in mirror; will `bill_pmt_add` against `resolved_bill_txn_id`.

**Hover-expand** reveals a secondary line:
```
    Pp: Native Teams · Expense: Vendor Consultants (600000) · From: 8220 Key Point Checking · Memo: "Sep 2026 - Anela Kaltak - INV 1042"
```

**Click-to-edit** — only the QB Vendor field. Opens an inline picker (autocomplete against `qb_vendors`) that also allows "Save as mapping" (writes to `qb_vendor_mappings` with the resolved pp_id).

**Discrepancy flag** — a warning icon prepends the checkbox column when set:
- Row is default **unchecked** (per §1.4 style — verify before pushing).
- Hover icon → tooltip lists reasons.
- Rules in §5.8.

**Card-level bulk controls (top-right corner of card):**
- `Select All / None`  (visible only when > 1 row)
- `Skip Selected`  (moves to Skipped card)
- Primary CTA at card footer: **`Push Selected (5 · $12,400)`**  — counts + amount preview reflect current selection; disabled if 0 selected.

### §5.3 Needs Vendor Mapping card

**Purpose:** rows the 3-tier mapping stack (§5.9 mapping tier stack) couldn't auto-resolve, OR AI tier returned LOW confidence.

**Row anatomy:**

```
[  ] Nejra Muzaferija · INV NT-1d8d1b · $5,040 · Sep 2026 · Pp: Native Teams
     Suggest: [ Native Team Nejra ]  [ Native Teams LTD ]  [ Native Team - Buzaljko ]
     Or type: [ ______________________________________________ ]  [ Map & Send to Ready ]
```

- No checkbox on the header row (can't push until mapped).
- Contractor + invoice + amount + month + pp label (all read-only).
- **Suggest row:** up to 3 AI candidate chips (§5.9 tier 3) — click a chip to select. Confidence % shown on hover.
- **Type row:** manual autocomplete against `qb_vendors`.
- **`Map & Send to Ready` button:** commits the mapping to `qb_vendor_mappings` (via pp_id — §5.7), moves the row to Ready.

**Also on this card:** rows where the tier stack found a mapping but the AI confidence was MEDIUM. Those get a badge "AI-suggested — verify" and their target is pre-filled; user just clicks confirm.

### §5.4 Skipped card

**Purpose:** rows the user explicitly moved out of Ready ("not this batch").

**Row anatomy:** same as Ready but greyed out, checkbox replaced with `[Unskip]` button. Unskipping returns the row to Ready with default state (checked if no discrepancy, unchecked otherwise).

Skips are session-scoped — reloading the tab returns rows to their natural card. Persistent skips are out of scope for v2 (add later if needed).

### §5.5 Pushed today card

**Purpose:** rows completed during this session.

**Row anatomy:** verdict chip updates to actuals:

```
[✓] Anela Kaltak · INV-1042 · $2,400 · Sep 2026 · Native Team Anela  [Created Bill 12345 + BillPayment 12346]
```

Failed rows are visible in the pane's failed subsection with the failure reason (§5.10 push messages) and a `Retry` button.

**Not a persistent history.** For long-term "what did we push" queries, `qb_ingest_events` remains authoritative. This card is a session rollup only.

### §5.6 Vendor Mapping sub-tab

Own sub-tab under QB Automation v2 tab, not the main landing view. Navigable via footer link (§5.1.5) or top-level tab bar.

**Layout:**
- Search box (contractor name / pp label).
- Table columns: `Contractor | Payment Profile | QB Vendor | Bills routed via this mapping | Actions`.
- Sortable by every column, defaulting to Contractor A→Z.
- Row actions: `Edit` (inline), `Delete`, `History` (expand to show past bills).
- Top-right: `+ Add mapping` button.

**Real-time:** the sub-tab and the Ready view share a Supabase Realtime channel on `qb_vendor_mappings`. An edit in either place propagates to the other within 1–2s.

**Historical rows:** when a contractor has prior bills in `qb_mirror` under a specific QB vendor but no mapping exists, that row appears in this table with a `Seed from history` action — one click creates the mapping.

### §5.7 Mapping key (pp_id, not counterparty_pattern)

Locked in [[qb-automation-v2-pivot]] Option A. Summary:

- `qb_vendor_mappings` gains a `pp_id` column (bigint, nullable during migration, NOT NULL after backfill).
- UNIQUE constraint moves from `(source, counterparty_pattern)` to `(pp_id)`.
- `counterparty_pattern` becomes advisory / debug only, or is dropped entirely (decision in Slice V1).
- Backfill: for each existing row, resolve counterparty_pattern → invoices → pp → pp_id. Rows that can't resolve surface as "orphan mappings" for Dan to review.
- v2 tier-1 lookup: `SELECT qb_vendor_list_id FROM qb_vendor_mappings WHERE pp_id = ?`.
- Rejected fallback: wire-text mapping (Dan's reasoning — Convera Batch Export module is the forward channel for new benes; truly-unknown wires deserve human attention, not auto-routing).

**Classifier change:** the source adapter's mapping lookup switches to pp_id-primary. This is a plumbing change (Layer 3 of [[qb-automation-architecture]]) — v1 gets the fix for free.

### §5.8 Discrepancy detection

Rules that flag a Ready row (warn icon + default-unchecked):

1. **Rate drift** — `invoice.rate` ≠ current `rate_history` bill_rate for that contractor. Reason string: "Invoice rate $X ≠ current contract rate $Y".
2. **Bank drift** — pp bank details changed since last successful bill to this pp (mirror-deviation table [[convera-push-routing]]). Reason: "Bank changed from … to …".
3. **Umbrella mismap** — pp is candidate umbrella (like Teal) but tier stack wants a per-contractor vendor. Reason: "Teal is a shared vendor across 8 contractors — verify this is the right target".
4. **Duplicate RefNumber** — [[qbwrite-invariants]] #12: another bill in mirror has the same (vendor_list_id, ref_number). Reason: "QB already has bill …".
5. **AI-suggested MEDIUM** — tier 3 returned a candidate but confidence 60–90%. Reason: "AI-suggested at 78%, verify".
6. **Missing expense account fallback** — very rare; per-contractor override missing and no default. Reason surfaces the exact missing field.

Each flag has a **`Resolve`** action link that opens the appropriate correction path (edit the invoice, edit the mapping, override the target). Once resolved, the flag clears and the row re-defaults to checked.

### §5.9 Sync surface + mapping tier stack

**Sync surface** (recap from §5.1):
- Three freshness pills: Mirror, Vendors, QBWC heartbeat.
- Green < 15min, amber 15–60min, red > 60min.
- Click any pill → run corresponding sync (button + pill share a handler).

**Auto-sync behavior:**
- On tab load: if any pill is amber/red, quietly kick off the sync in the background (non-blocking).
- Before push (§5.11 preflight): if unmapped rows exist and Vendors > 15min, auto-Sync Vendors before push (preflight).
- After push: auto-run both syncs so the next tab visit is fresh.

**Mapping tier stack (used by classifier + Ready row rendering):**

1. **Tier 1 — exact.** `qb_vendor_mappings WHERE pp_id = <pp>`. Auto-map, checked.
2. **Tier 2 — history.** `qb_mirror` bills where the invoice's user_id matches. If contractor has ≥1 bill under a specific vendor, suggest that vendor. Auto-map, checked. Confidence "High (history)".
3. **Tier 3 — LLM (Haiku 4.5, same pipe as [[ai-gateway-migration]]).** Fuzzy match pp label + contractor name against `qb_vendors` list. Emit confidence + top-3 candidates:
   - HIGH (>90%): auto-map, "AI suggested" chip, row checked.
   - MEDIUM (60–90%): map as suggestion, badge "AI-suggested — verify", row **unchecked** (discrepancy §5.8.5).
   - LOW (<60%): drop into Needs-Vendor-Mapping card with the 3 candidate chips.

Tiers run in order. First tier that returns wins. Tier 3 is the slow path — cached per session per pp_id.

### §5.10 Confirmation copy — plain English

Every user-facing string. Red-line pass with Dan during Slice V11.

**Pre-push preview (Ready card CTA hover):**
- Empty selection: `Select rows to push`.
- 1 row: `Push 1 item · $2,400`.
- N rows: `Push N items · $X,XXX`.

**Preflight blocks:**
- Discrepancy: `Resolve N discrepancies before pushing.` (Push button disabled with tooltip.)
- Missing vendor sync: `2 selected rows use vendors not in QB Vendors. Sync Vendors first?` (Push runs after auto-sync.)

**During push (per row, in push status pane):**
- `Creating Bill for Anela Kaltak · INV-1042 · $2,400 …`
- `Paying Bill INV-1042 · $2,400 from 8220 Key Point Checking …`

**Post-push per row (in Pushed today card):**
- Success create+pay: `Created Bill 12345 ($2,400) + BillPayment 12346 from 8220 Key Point Checking.`
- Success pay-only: `Paid Bill 12345 ($2,400) with BillPayment 12346 from 8220 Key Point Checking.`
- Failure: `Push failed: <specific reason>. <what to try>` — e.g. `Push failed: QB Vendor "Native Team Anela" not found in QB. Sync Vendors and retry.`
- Held: `On hold: <reason>. Resolve in Needs Mapping and retry.`

**Empty states:**
- Ready empty: `Nothing to push right now. Approve invoices in the Invoices tab to see them here.`
- Needs Mapping empty: `Every approved invoice has a mapping. Nice.`
- Pushed today empty: `No pushes yet in this session.`

**Vendor Mapping sub-tab:**
- Add mapping success: `Mapped <Contractor> · <Pp> → <QB Vendor>. Ready view updated.`
- Delete mapping confirm: `Delete mapping for <Contractor>? Future invoices from this pp will need re-mapping.`

**Sync outcomes (header pill flash):**
- Sync Vendors done: `Vendors synced · N vendors · <duration>`.
- Sync Mirror done: `Mirror synced · N bills, N payments · <duration>`.

### §5.11 Push flow (orchestration)

Locked from S8:

1. User selects rows in Ready card, clicks `Push Selected`.
2. **Preflight (blocking checks):**
   a. Any selected row has an unresolved discrepancy flag? → block with message §5.10 "Resolve N discrepancies".
   b. Any selected row's QB vendor missing from `qb_vendors` mirror? → auto-run `Sync Vendors`, wait, re-check. Still missing? → block.
3. **Preflight (non-blocking):**
   c. Mirror age > 15min? → kick off `Sync Mirror` in background, don't wait.
4. **Push phase 1: mappable-first.** Push all rows that are ready — bill_add + bill_pmt_add chained per row via existing `pushConveraCreateBillAndPay` / per-source pushers. QbPushStatusPane streams per-row status.
5. **Sync phase:** after phase 1 completes, auto-run `Sync Vendors` + `Sync Mirror`.
6. **Push phase 2: newly-resolved rest.** If any rows in Needs Mapping are now auto-resolvable (thanks to fresh vendor sync), they surface in Ready with a "New — verify" flag. User can push them in a second click.
7. **Post-push:** rows move from Ready → Pushed today. Failed rows move to Pushed today's failed subsection with `Retry`.

**Cancellation:** user can click `Cancel remaining` in the push status pane. Rows not yet in flight stay in Ready.

### §5.12 v1 UX contract — what carries, what amends, what retires

From [[qb-automation-ux-contract]]:

| # | v1 rule | v2 disposition |
|---|---|---|
| 1 | Consistent section shape (header + count + rows) | **Amend** — v2 uses category cards, same principle but new visual language. |
| 2 | Universal counter + In Progress pane | **Carry** — KPI strip (§5.1) + `<QbPushStatusPane>` reused. |
| 3 | Sortable columns | **Carry** — every table sortable by every column, contractor by default. |
| 4 | Month-rollup posted section | **Amend** — becomes "Pushed today" (session) + `qb_ingest_events` for long-term. Month rollup retires; user can query history via the Vendor Mapping sub-tab's `History` row action. |
| 5 | Amber counters when > 0 | **Carry** — Needs Mapping KPI is amber if > 0. |
| 6 | Click-to-inspect on all counters | **Carry** — every KPI click-jumps to its card. |

### §5.13 Cutover criteria — "Dan is happy" checklist

Concrete gates to flip the admin gate and delete v1:

1. **All four push paths tested E2E in v2:** single-invoice Convera (C-1), umbrella Convera (C-2), Intuit XLSX (I-1), manual invoice (I-2/M).
2. **Three consecutive real batches** run through v2 with zero mismap (verified against accountant's QB after each batch).
3. **Accountant does a full session on v2** and reports no confusion (single question at end: "did anything confuse you?").
4. **Push status pane fires** for every event in every batch (no silent partial failures).
5. **All six v1 UX rules covered per §5.12** — carry rules preserved, amend rules landed cleanly.
6. **Vendor Mapping sub-tab has zero orphan rows** (every mapping row has a pp_id resolved).
7. **Dan runs 3 sanity queries** against `qb_ingest_events` post-push (all pushes trace to expected pp/vendor).

## §6. Non-goals (things v2 does NOT touch)

- 4-layer plumbing ([[qb-automation-architecture]]) — untouched.
- `qbWrite` executor + 36 invariants ([[qbwrite-invariants]]) — untouched.
- Source adapters (Convera, Intuit classifiers) — untouched.
- `qb_mirror` schema — untouched.
- QBWC layer — untouched.
- Any behavior of v1 — untouched (v1 stays live until cutover).

## §7. Related

- [[qb-automation-v2-pivot]] — this arc's origin decision.
- [[qb-automation-ux-contract]] — v1 UX rules (some may amend in v2).
- [[qb-automation-architecture]] — 4-layer model (v2 reuses whole).
- [[qbwrite-invariants]] — executor rules (v2 doesn't touch).
- [[umbrella-payment-patterns]] — Native Teams / TCode / Bimosoft / Teal umbrella semantics that v2's mapping UX must reflect.
- [[intuit-qb-layer-spec]] — 8-case spec across Intuit×Convera flows.
- `.claude/plans/accountant-modularization.md` — parent arc; Chunk 8 SUPERSEDED by this doc.

## §8. Session log

**S7 (2026-09-18, PM) — pivot session.**
- STOP GATE reached at end of S6 after IB slice merged (`801b080`).
- Dan chose Path 3 (rebuild UI, keep plumbing).
- Locked: v1 frozen; v2 ground-up at `src/roles/Accountant/tabs/QbAutomationV2/`; admin-gated; reuse plumbing + design language from QbExport modal.
- Chunk 8 in `.claude/plans/accountant-modularization.md` marked SUPERSEDED.
- Memory saved: [[qb-automation-v2-pivot]]. [[qb-automation-stop-gate]] marked RESOLVED.
- Next: Dan gives directionality → Claude asks questions → §5 sections + flows populated → v2 spec locks → code starts.

**S8 (2026-09-21) — spec locked, slice roadmap.**
- Dan dumped directionality → Claude asked 4 rounds of follow-ups → answers locked spec.
- Historical seed run (`scripts/one-off/qb-vendor-mapping/historical-seed.cjs`): pp is 1:1 with contractor; Teal is only true umbrella; zero drift from our 16 pushes.
- Locked: mapping key = pp_id (Option A — wire-text fallback rejected due to drift risk); 3-tier smart mapping (exact → history → LLM Haiku); one-line Ready rows with hover-expand + click-to-edit; sync preflight order (push mappable first → sync → resolved rest); north star principle (§1 decision #7).
- §5 populated (§5.1–§5.13). §9 slice roadmap added.
- 3 misrouted `qb_vendor_mappings` rows confirmed on prod: NT LIMITED → Buzalko (id 81), NT LTD → Marin Purgar (id 64), Deniz D-KODE → Amra vendor (id 72). Dan holding QB push queue until Slice V1 lands.
- Memory saved: [[qb-vendor-mapping-truths-2026-09]] (durable empirical baseline); [[qb-automation-v2-pivot]] updated with S8 decisions.
- Next: Slice V1 next session (see §9).

## §9. Slice roadmap (multi-session pickup)

Twelve self-contained slices. Each has: goal, files touched, acceptance, blocker checks, and rollback. Sequential dependencies noted. Any future session can cold-start at any slice by reading §0 → this slice's entry.

Estimates are ranges; lean low per [[dont-overpad-estimates]].

### Slice V1 — pp_id migration + classifier tweak (UNBLOCKS BUZALKO)
**Est:** 2–3h. **Blocker for:** all downstream v2 work; also unblocks Dan's held push queue.

**Goal:** move `qb_vendor_mappings` key from `counterparty_pattern` to `pp_id`. Classifier prefers pp_id row. Fix the 3 misrouted rows as a natural consequence.

**Files:**
- New migration: `supabase/migrations/2026092X_qb_vendor_mappings_pp_id.sql`
- Backfill script: `scripts/one-off/qb-vendor-mapping/backfill-pp-id.cjs`
- Classifier: `src/lib/qbClassify/**` (or wherever the F.5 classifier lives — locate on entry).
- Tests: `src/lib/qbClassify/__tests__/*.test.ts` — add pp_id-first lookup test.

**Migration steps:**
1. `ALTER TABLE qb_vendor_mappings ADD COLUMN pp_id bigint REFERENCES payment_profiles(id)`.
2. Backfill via script (read-only compute, single UPDATE): for each existing row, resolve counterparty_pattern → sample invoice matching it → invoice.payment_profile->>'id'. Log unresolvable rows to console.
3. `DROP INDEX qb_vendor_mappings_lookup_idx`.
4. `ALTER TABLE qb_vendor_mappings DROP CONSTRAINT qb_vendor_mappings_source_counterparty_pattern_key`.
5. `CREATE UNIQUE INDEX qb_vendor_mappings_pp_id_key ON qb_vendor_mappings (pp_id) WHERE pp_id IS NOT NULL`.
6. `counterparty_pattern` becomes nullable + advisory (keep for one release, drop in a follow-up).

**Classifier change:**
- Prefer `WHERE pp_id = <pp>` when the event has a resolvable pp.
- Fall back to `WHERE counterparty_pattern = counterparty_raw AND pp_id IS NULL` for legacy rows during transition.
- After all rows have pp_id, remove the fallback branch.

**Manual data steps (post-migration, in a plan-doc comment for Dan to run):**
- Insert per-contractor NT mappings for known Native Teams contractors (list produced from seed).
- Delete unresolvable orphan rows after Dan reviews them.

**Acceptance:**
- Backfill covers ≥ 99 of 102 existing rows (allow up to 3 orphans, Dan reviews).
- Unit test: pp_id row wins over counterparty_pattern row for same event.
- Manual E2E: push a small test batch → Buzalko/Marin no longer misroute; Deniz routes to his own vendor.
- Dan releases the held push queue.

**Rollback:** revert migration + revert classifier change. Zero data loss (counterparty_pattern preserved).

**Cold-start read order:** §0 → §5.7 → this entry → memory [[qb-vendor-mapping-truths-2026-09]].

---

### Slice V2 — QbAutomationV2 skeleton + admin gate
**Est:** 1–2h. **Depends on:** V1 (not strictly, but no reason to build UI until mapping is fixed).

**Goal:** create the v2 tab folder + a placeholder tab visible only to admins.

**Files:**
- New: `src/roles/Accountant/tabs/QbAutomationV2/index.tsx` — renders a "coming soon" placeholder.
- Edit: `src/TimesheetSystem.tsx` — add admin-gated tab entry alongside the existing QB Automation tab. Dan (admin) sees v2 tab; accountant sees v1 only.
- New: `src/roles/Accountant/tabs/QbAutomationV2/README.md` — module intent + link to plan doc.

**Acceptance:**
- Dan sees "QB Automation v2 (admin preview)" tab. Accountant does not.
- Placeholder renders cleanly.
- No regression in v1.

**Rollback:** delete tab folder + revert TS.tsx tab-nav change.

---

### Slice V3 — Ready card + row anatomy + verdict lib
**Est:** 5–7h. **Depends on:** V2.

**Goal:** first real content in v2. Reads existing wrapper state; renders Ready card per §5.2.

**Files:**
- New: `src/roles/Accountant/tabs/QbAutomationV2/sections/ReadyCard.tsx`
- New: `src/roles/Accountant/tabs/QbAutomationV2/hooks/useQbAutomationV2.ts`
- New: `src/lib/qbAutomation/verdict.ts` — pure fn: given event + mirror state → verdict (`will_create_and_pay` | `will_pay` | ...).
- New: `src/lib/qbAutomation/__tests__/verdict.test.ts`
- Edit: `src/roles/Accountant/tabs/QbAutomationV2/index.tsx` — compose card.

**Acceptance:**
- Rows render per §5.2 anatomy.
- Verdict chip correct on ≥ 3 sample event types (unit tests).
- Bulk select/deselect works.
- Push button shows correct count + amount preview.
- Push button is wired to a no-op handler for now (V8 wires the real push).

**Rollback:** delete new files; revert placeholder.

---

### Slice V4 — Needs Vendor Mapping card + inline resolve
**Est:** 3–5h. **Depends on:** V3.

**Goal:** render §5.3. No AI yet (V6 adds it) — for now, blank suggest chips + manual autocomplete.

**Files:**
- New: `src/roles/Accountant/tabs/QbAutomationV2/sections/NeedsMappingCard.tsx`
- Edit: `useQbAutomationV2.ts` — bucket events into cards.

**Acceptance:**
- Rows without a tier-1 hit surface here.
- Manual autocomplete works; commit writes to `qb_vendor_mappings` via existing `saveQbVendorMapping` (with pp_id per V1).
- Committing a mapping moves the row to Ready in real time.

**Rollback:** delete file + revert bucketing.

---

### Slice V5 — Vendor Mapping sub-tab
**Est:** 3–5h. **Depends on:** V4.

**Goal:** §5.6.

**Files:**
- New: `src/roles/Accountant/tabs/QbAutomationV2/sections/VendorMappingSubTab.tsx`
- New (or reuse): mapping-CRUD handlers already exist as wrappers; import as-is.
- Edit: `src/roles/Accountant/tabs/QbAutomationV2/index.tsx` — sub-tab routing.

**Acceptance:**
- Table renders with contractor-primary sort.
- Add / Edit / Delete work.
- Realtime channel updates Ready view within 2s of an edit.
- `Seed from history` action creates a mapping from a mirror bill lookup.

**Rollback:** delete file.

---

### Slice V6 — 3-tier smart mapping lib
**Est:** 4–6h. **Depends on:** V4 (needs NeedsMappingCard to render suggestions).

**Goal:** implement §5.9 tier stack. Tier 1 already works (V1 delivered). This slice adds tier 2 (history) + tier 3 (LLM).

**Files:**
- New: `src/lib/qbAutomation/vendorMappingResolver.ts` — pure fn returning `{ tier, vendor_list_id, confidence, alternates[] }`.
- New: `src/lib/qbAutomation/__tests__/vendorMappingResolver.test.ts`
- Edit: NeedsMappingCard.tsx — render alternates as chips.

**LLM implementation:**
- Use existing Anthropic pipe from [[ai-gateway-migration]] (Haiku 4.5).
- Prompt: give it pp label + contractor name + full `qb_vendors` list (or filter to plausible matches by first-letter/token).
- Return structured JSON: `{ candidate, confidence, alternates: [{ candidate, confidence }] }`.
- Cache per (pp_id, vendors_list_version) in session storage.

**Acceptance:**
- Tier 2 finds "Native Team Anela" for Anela's Native Teams pp based on mirror history.
- Tier 3 returns HIGH for exact-string matches, MEDIUM for close variants, LOW for genuine unknowns.
- Tests cover each tier + confidence bucket.
- Cost budget check: ≤ 100 LLM calls per session (log warning if exceeded).

**Rollback:** delete lib fn + revert NeedsMappingCard chips.

---

### Slice V7 — Discrepancy detection
**Est:** 3–5h. **Depends on:** V3 (adds flags to Ready rows).

**Goal:** §5.8 rules.

**Files:**
- New: `src/lib/qbAutomation/discrepancies.ts` — pure fn per rule.
- New tests.
- Edit: ReadyCard.tsx — render flag + tooltip + `Resolve` action.

**Acceptance:**
- All 6 rules fire on synthetic test cases.
- Real-data smoke test: 2–3 flags surface on current prod invoices.
- Resolve action opens correct correction path.
- Flagged rows default-unchecked; unflagging re-checks.

**Rollback:** delete lib + revert card.

---

### Slice V8 — Push flow + preflight
**Est:** 4–6h. **Depends on:** V3, V7.

**Goal:** §5.11.

**Files:**
- New: `src/roles/Accountant/tabs/QbAutomationV2/hooks/useQbPushFlow.ts`.
- Edit: ReadyCard.tsx — wire Push CTA.
- Edit: index.tsx — mount `<QbPushStatusPane>` (reused).

**Acceptance:**
- Preflight blocks correctly per §5.11 (discrepancy, missing vendor).
- Push phase 1 fires all mappable rows via existing pushers.
- Post-push auto-sync runs.
- Phase 2 re-classifies + surfaces newly-resolved rows.
- Cancellation works.
- Rows land in Pushed today card with actuals.

**Rollback:** delete hook + revert ReadyCard CTA.

---

### Slice V9 — Skipped + Pushed today cards
**Est:** 2–3h. **Depends on:** V3, V8.

**Goal:** §5.4 + §5.5.

**Files:**
- New: `sections/SkippedCard.tsx`, `sections/PushedTodayCard.tsx`.
- Edit: `useQbAutomationV2.ts` — bucketing.

**Acceptance:**
- Skip / Unskip round-trip.
- Pushed today rows show actuals + retry.
- Failed rows separate visually.

**Rollback:** delete files.

---

### Slice V10 — Sync surface + freshness pills
**Est:** 2h. **Depends on:** V2.

**Goal:** §5.1.1 + §5.9 sync UX.

**Files:**
- New: `sections/HeaderPills.tsx` (or fold into `Header.tsx`).
- Edit: `useQbAutomationV2.ts` — read `qbWcLastSeen`, snapshot ages.

**Acceptance:**
- Three pills render correct color per age thresholds.
- Click pill → runs sync.
- Auto-sync on tab load if amber/red.

**Rollback:** delete file.

---

### Slice V11 — Plain-English copy sweep
**Est:** 1–2h. **Depends on:** V3, V4, V5, V8.

**Goal:** §5.10 red-line pass. Dan reviews every string.

**Files:** touch every card / pane / hook that emits user-facing text. No new files.

**Acceptance:**
- Dan signs off on every string.
- Zero technical jargon or codenames in UI (per [[no-internal-codenames-in-ui]]).

**Rollback:** revert strings.

---

### Slice V12 — Cutover
**Est:** 1–2h. **Depends on:** all slices + §5.13 checklist passed.

**Goal:** flip admin gate. Delete v1.

**Files:**
- Edit: `TimesheetSystem.tsx` — remove admin gate; accountant now sees v2 by default; delete v1 tab render + its imports.
- New: `.claude/archive/deprecated-2026-XX-qb-automation-v1.md` per [[archive-deleted-code]].
- Delete: any v1-only helpers no longer referenced.

**Acceptance:**
- Accountant loads app → sees v2 as the QB Automation tab.
- No dead imports (`npm run build` green).
- Archive doc written.

**Rollback:** revert commit; v1 restored.

---

**Total est:** 30–46h across 12 slices. Multi-session pickup by design — any slice can cold-start from §0 + its own entry.

**Session cadence expectation:** 1 slice per session is comfortable. Slice V1 first (unblocks Dan). Slices V2+V3 can be back-to-back. Slices V4–V11 mostly independent (V4 → V5/V6/V7 in parallel; V8 depends on V7).
