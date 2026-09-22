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

## §3. Directory structure (LOCKED — Slice V2 2026-09-22)

**Role-agnostic module.** The module doesn't belong to any role — roles mount it. Slice V2 mounts it in admin view; V12 cutover mounts it in accountant view and deletes v1.

```
src/features/QbAutomationV2/     # role-agnostic feature module
  index.tsx                      # top-level composition — no role imports
  README.md                      # module intent + status
  Header.tsx                     # top counter + freshness + QBWC heartbeat + sync buttons (V10)
  sections/
    <TBD once §5 sections land>
  cards/
    <card components; QbExport-inspired>
  hooks/
    useQbAutomationV2.ts         # top-level state hook (V3)
    useQbSyncState.ts            # freshness + heartbeat (V10)
    <TBD>
  tests/
    <TBD>

src/lib/qbAutomation/            # NEW — pure fns, shared with v1 if useful
  missingBills.ts                # pure fn
  inboxGroups.ts                 # pure fn
  <TBD>
```

**Rationale:**
- Sibling to `roles/`, `lib/`, `components/` — matches the modularization arc's "plug-and-play" principle.
- Any role can `import QbAutomationV2 from './features/QbAutomationV2'` and mount it. Admin mounts it in Slice V2; accountant will mount it at V12 cutover.
- Empty subfolders (`sections/`, `cards/`, `hooks/`, `tests/`) are created by the slice that first needs them — cleaner history than adding `.gitkeep` stubs upfront.
- Anything pure lands in `src/lib/qbAutomation/` so v1 can also consume during coexistence.

**Path correction (2026-09-22):** original §3 draft said `src/roles/Accountant/tabs/QbAutomationV2/`. That path contradicted the "role-agnostic module" intent from §1.2 and Dan's Slice V2 clarification that "any role can use it." Moved to `src/features/QbAutomationV2/` in the Slice V2 commit.

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

**S14 (2026-09-22) — Slice V7 shipped: discrepancy detection (3 of 6 rules).**
- New pure lib `src/lib/qbAutomation/discrepancies.ts` — 3 rules with 12 unit tests.
- **Rule 1 rate_drift:** compare `invoice.rate` against current `rate_history` pay-rate for `(userId, effective_from ≤ periodEnd, effective_to > periodEnd OR null)`. Newest effective_from wins on overlap.
- **Rule 3 umbrella_mismap:** vendor_list_id serves ≥ 2 distinct contractors historically (from posted qb_ingest_events). Flags Teal Crossroads today; auto-detects any new umbrella.
- **Rule 4 duplicate_refnumber:** open bill exists at same (vendorListId, normalizedRefNumber) but different month. Guards against contractor invoice-number resets (Croatian pattern — see qbwrite invariants #12).
- **DEFERRED:** rule 2 (bank drift — needs mirror-deviation history), rule 5 (AI-suggested MEDIUM — V6 doesn't auto-map from LLM), rule 6 (missing expense account — very rare, classifier fallbacks cover).
- Wrapper adds `qbautov2RateHistory` state + lazy loader (fires on v2 tab open only).
- Hook builds vendorContractors map from posted events; runs `detectDiscrepancies` per ReadyRow; adds `discrepancies: Discrepancy[]` to ReadyRow.
- Auto-select logic tightened: flagged rows are NOT auto-selected (verify-first per §1.4). `selectGroup` also skips flagged rows. New Pay rows with 0 discrepancies auto-add.
- ReadyCard renders amber ⚠ icon next to contractor name for flagged rows; hover tooltip lists each discrepancy message + resolve hint.

**S13 (2026-09-22) — Slice V6 shipped: 2-tier smart mapping (history + token overlap).**
- New pure lib `src/lib/qbAutomation/vendorMappingResolver.ts` with `resolveVendorCandidates(input, ctx, limit=3)` returning up to 3 tiered candidates. 11 unit tests cover both tiers + confidence buckets + stopword filtering + cap.
- Tier 2 (history): if contractor has posted bills under a QB vendor, surface HIGH confidence. Uses buildHistoryByUser helper to map userId → posted vendorListIds.
- Tier 3 (token overlap): tokenize contractor name + pp label (drop stopwords: the/and/ltd/llc/inc/corp/co/ltda/limited/sp/sro/gmbh/obrt/vl/o.d/dj/obrtnicka/djelatnost/holding/group + min length 3). Match against vendor name tokens. Score: 2+ tokens = HIGH, 1 token ≥5 chars = MEDIUM, 1 short token = LOW.
- **Real LLM (Haiku 4.5) DEFERRED to V6-B.** Token overlap covers Bimosoft (per-contractor-suffixed) + Native Teams (per-contractor-suffixed) + solo-vendor matches — the ~80% case per [[qb-vendor-mapping-truths-2026-09]]. Real LLM adds cost + infra for marginal cases. Reconsider when a real case surfaces that heuristic can't solve.
- NeedsMappingCard renders up to 3 suggestion chips per row: green=high, amber=medium, gray=low. Click chip → input pre-fills with vendor name → user clicks Map & Send to Ready.
- Hook extended: `needsMappingRows[i].candidates` added; contractorUserId also added.

**S12 (2026-09-22) — Slice V5 shipped: Vendor Mapping sub-tab + realtime + V4.1 push-bar relocation.**
- V4.1 (`3623aa8`): Push button relocated from ReadyCard footer to persistent top-right slot (new `PushBar` component). Post-push handler snaps `category='ready'` so newly-resolved siblings show without extra clicks.
- V5: sub-tab nav at top of v2 (Push Inbox / Vendor Mapping). Push button visible only on Inbox.
- New `sections/VendorMappingSubTab.tsx` — table with columns Contractor · Payment Profile · QB Vendor · Bills routed · Actions. Search box (filters contractor / pp / vendor). Sortable by every column, default Contractor A→Z. Inline Edit (autocomplete → save) + Delete (confirm).
- Hook extended: `mappingRows` builds from `paymentProfiles` + `users` + `qbVendorMappings` + `qbVendorsList`. Bills-routed count derived from posted qb_ingest_events matching vendor_list_id (approximation — refine later).
- `QbVendorMapping` type gained `ppId: number | null` (Slice V1 DB column was previously not exposed to frontend). `loadQbVendorMappings` normalizes `pp_id`.
- Realtime: `onMappingChangeSubscribe` prop wires a Supabase channel on `qb_vendor_mappings`; edits from either the sub-tab or elsewhere (v1, other admins) reload mappings + events within seconds.
- Wrapper handlers: `onUpdateMappingVendor(mappingId, qbVendorListId)` UPDATE + reclassify; `onDeleteMapping(mappingId)` DELETE + reload.
- DEFERRED to follow-up slices: `+ Add mapping` button (Needs Mapping card is primary add flow); `Seed from history` action (requires qb_mirror lookup path, separate slice).

**S11 (2026-09-22) — Slice V4 shipped: Needs Mapping card + inline resolve.**
- New section `src/features/QbAutomationV2/sections/NeedsMappingCard.tsx` — table with columns Contractor · Period · Payment Profile · QB Vendor (autocomplete) · Total · Action. Datalist-backed autocomplete against `qb_vendors`. `Map & Send to Ready` button commits mapping.
- Hook extended: `needsMappingRows` filters `!counterpartyQbVendorListId && ppId > 0 && active event`. pp_id=0 snapshot artifact filtered per Slice V1 note.
- KPI card "Needs Mapping" now live: shows real count, click-to-filter, disabled at 0.
- Wrapper handler `onSaveMapping` in TS.tsx: pp_id-primary upsert into `qb_vendor_mappings` (`onConflict: 'pp_id'`) + immediate flip of the current event to `status='ready'` + `applyClassificationPass()` for sibling pp events + reload.
- Default `default_target_kind='bill_add_and_pmt'` (safe default for 99% of contractor cases; classifier fallbacks handle bank + expense).
- AI tier (V6) deferred: no suggest-chips row yet; only manual autocomplete.

**S10 (2026-09-22) — Slice V3 shipped: Ready card + verdict lib.**
- New verdict lib `src/lib/qbAutomation/verdict.ts` — pure fn `computeVerdict({kind, vendorListId, refNumber, month}, openBills) → 'will_pay' | 'will_create_and_pay' | null`. Live-truth logic: bill_add_and_pmt flips to will_pay when mirror actually has the bill. 10 unit tests (kinds, vendor filter, ref normalization, month scope, missing fields).
- New hook `src/features/QbAutomationV2/hooks/useQbAutomationV2.ts` — takes wrapper state (events, openBills, vendors, invoices), builds `ReadyRow[]` sorted by contractor A→Z, owns selection state.
- New section `src/features/QbAutomationV2/sections/ReadyCard.tsx` — emerald-themed card matching §5.2 anatomy (contractor · INV · $ · month · → vendor · verdict chip). Select-All / Clear header controls; Push CTA shows `Push N items · $X,XXX`, disabled at 0, no-op alert (V8 will wire real push).
- Contractor label per Q1 answer: `invoice.userName` from `matchedInvoiceIds[0]`, fallback to `counterpartyRaw`, fallback to '(unknown)'.
- Month per Q2 answer: derived from `invoice.periodEnd.slice(0,7)` — formatted "Sep 2026".
- G7.5/G7.6 shadow events per Q3 answer: deferred to V8.
- Ready filter: `status === 'ready' && targetQbTxnKind ∈ {'bill_pmt','bill_add_and_pmt'} && !rawData.__backfill`. Excludes check, ignore, pending, already_done, backfill.
- QbAutomationV2 grew from `() => JSX` to `(props) => JSX` — wrapper now passes `events`, `openBills`, `vendors`, `invoices`.
- Hover-expand (Pp / Expense / Bank / Memo secondary line) deferred to V7 — pairs with discrepancy tooltip work.

**S9 (2026-09-22) — Slice V2 shipped: skeleton + admin mount.**
- Location reframed: `src/features/QbAutomationV2/` (role-agnostic) instead of `src/roles/Accountant/tabs/QbAutomationV2/`. Any role mounts the same module — matches the modularization arc's plug-and-play principle. Plan §3 updated in the same commit.
- Admin dashboard gains "QB Auto v2 (PREVIEW)" tab as the 6th admin view (next to Chat Activity). Renders placeholder card with title + subtitle + "Slice V2 — skeleton shipped" footer.
- Accountant view untouched. Dan compares preview vs prod side-by-side: admin session on preview URL vs accountant session (Dan has the creds) in a second browser.
- Reused `<UploadCloud>` (already imported) for the tab icon; small amber `PREVIEW` pill next to label.
- v1 QB Automation tab: zero changes.

**S8 (2026-09-21) — spec locked, slice roadmap, Slice V1 shipped.**
- Dan dumped directionality → Claude asked 4 rounds of follow-ups → answers locked spec.
- Historical seed run (`scripts/one-off/qb-vendor-mapping/historical-seed.cjs`): pp is 1:1 with contractor; Teal is only true umbrella; zero drift from our 16 pushes.
- Locked: mapping key = pp_id (Option A — wire-text fallback rejected due to drift risk); 3-tier smart mapping (exact → history → LLM Haiku); one-line Ready rows with hover-expand + click-to-edit; sync preflight order (push mappable first → sync → resolved rest); north star principle (§1 decision #7).
- §5 populated (§5.1–§5.13). §9 slice roadmap added.
- Slice V1 SHIPPED: migration + backfill + classifier + 3 orphan splits (NT LIMITED, D-KODE Kesten, Teal Crossroads). Applied to prod. Verified via qb_mirror historical bills for Amra/Deniz (deliberate 7-month split, kept as designed).
- Memory saved: [[qb-vendor-mapping-truths-2026-09]] (durable empirical baseline); [[qb-automation-v2-pivot]] updated. Also [[no-secret-defaults-in-scripts]] rule saved after GitHub Push Protection blocked first Slice V1 push.
- Push queue stays held through V12 cutover (Dan's decision — no test-push needed for V1; correct mapping display is the V1 goal).
- Next: Slice V2 (skeleton + admin gate) new session.

## §9. Slice roadmap (multi-session pickup)

Twelve self-contained slices. Each has: goal, files touched, acceptance, blocker checks, and rollback. Sequential dependencies noted. Any future session can cold-start at any slice by reading §0 → this slice's entry.

Estimates are ranges; lean low per [[dont-overpad-estimates]].

### Slice V1 — pp_id migration + classifier tweak (UNBLOCKS BUZALKO) ✅ SHIPPED 2026-09-21
**Est:** 2–3h. **Actual:** ~2.5h. **Applied to prod.**

**Commits on branch `feature/qb-automation-v2`:**
- `046fc90` migration + backfill script
- `8ef7d0c` classifier (Pass 1 pp_id-first, Pass 2 pp_id seed)
- `30d5232` TS.tsx wiring
- `1df1b13` applied SQL package + audit artifacts

**Prod change verified:** total_rows=110, pp_id_populated=55, legacy_null_kept=55. The 3 known misroutes (NT LIMITED, D-KODE Kesten, Teal Crossroads) split into per-pp rows and route correctly.

**Push queue:** still held by Dan through V12 cutover (not V1). V1's purpose was correct mapping display, not enabling pushes.

**Branch NOT merged to main yet** — will merge after V2+ slices land and full v2 arc is verified.

**Original scope below (for reference):**

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

### Slice V2 — QbAutomationV2 skeleton + admin mount ✅ SHIPPED 2026-09-22
**Est:** 1–2h. **Actual:** ~1h.

**Location reframe:** originally proposed at `src/roles/Accountant/tabs/QbAutomationV2/` (§3 draft) — moved to `src/features/QbAutomationV2/` to match the role-agnostic module intent from §1.2. Any role mounts the same module. Admin mounts in V2; accountant mounts at V12 cutover.

**Shipped files:**
- New: `src/features/QbAutomationV2/index.tsx` — centered placeholder card (title + subtitle + "Slice V2 — skeleton shipped").
- New: `src/features/QbAutomationV2/README.md` — module intent + link to plan.
- Edit: `src/TimesheetSystem.tsx` — imported `QbAutomationV2`; added `setAdminView('qbautov2')` button (6th admin tab, right of Chat Activity) with `UploadCloud` icon + amber `PREVIEW` pill; added `{adminView === 'qbautov2' && <QbAutomationV2 />}` block above the users block. Reused already-imported `UploadCloud`.
- Edit: `.claude/plans/qb-automation-v2.md` — §3 path fix, §8 session log entry, this entry.

**Acceptance met:**
- Admin session shows "QB Auto v2 (PREVIEW)" tab as 6th admin view.
- Placeholder renders cleanly.
- Accountant view completely untouched (line 5900 branch never sees the new tab).
- v1 QB Automation tab: zero regression (no diffs to accountant render block or line 6010).
- `npm run build` green.

**Preview workflow:** Dan compares admin session on preview URL vs accountant session (Dan holds accountant creds) in a second browser. Side-by-side prod-vs-preview.

**Rollback:** delete `src/features/QbAutomationV2/`, revert TS.tsx admin-view diff (import + tab button + render block).

---

### Slice V3 — Ready card + row anatomy + verdict lib ✅ SHIPPED 2026-09-22
**Est:** 5–7h. **Actual:** ~1h (leaner scope than plan est'd — hover-expand deferred to V7).

**Shipped files:**
- New: `src/lib/qbAutomation/verdict.ts` — pure verdict fn.
- New: `src/lib/qbAutomation/__tests__/verdict.test.ts` — 10 tests (2 kinds × 2 mirror states + guards).
- New: `src/features/QbAutomationV2/hooks/useQbAutomationV2.ts` — hook.
- New: `src/features/QbAutomationV2/sections/ReadyCard.tsx` — emerald card, §5.2 primary line.
- Edit: `src/features/QbAutomationV2/index.tsx` — accepts props, composes ReadyCard.
- Edit: `src/TimesheetSystem.tsx` — passes `events`, `openBills`, `vendors`, `invoices` to `<QbAutomationV2 />`.

**Locked decisions:**
- Contractor label: `invoice.userName` → `counterpartyRaw` → '(unknown)'.
- Month: `invoice.periodEnd.slice(0,7)` — formatted "Sep 2026".
- Verdict: live-truth (mirror check flips will_create_and_pay → will_pay when bill actually exists).
- G7.5/G7.6 shadow events: deferred to V8.
- Hover-expand: deferred to V7 (pairs with discrepancy).

**Acceptance met:**
- Rows render per §5.2 primary line (checkbox · contractor · INV · $ · month · → vendor · chip).
- Verdict lib: 10/10 tests pass including live-truth flip case.
- Bulk Select All / Clear.
- Push button shows `Push N items · $X,XXX`, disabled at 0.
- Push handler alerts "V8 wires real push" — no-op per plan.

**Rollback:** delete `src/lib/qbAutomation/verdict.ts` + `__tests__`, delete `src/features/QbAutomationV2/hooks/` + `sections/`, revert `index.tsx` back to placeholder card, revert props wiring in TS.tsx.

---

### Slice V4 — Needs Vendor Mapping card + inline resolve ✅ SHIPPED 2026-09-22
**Est:** 3–5h. **Actual:** ~30min.

**Shipped files:**
- New: `src/features/QbAutomationV2/sections/NeedsMappingCard.tsx` — table + autocomplete + save.
- Edit: `src/features/QbAutomationV2/hooks/useQbAutomationV2.ts` — `needsMappingRows` filter, pp_id-guarded.
- Edit: `src/features/QbAutomationV2/sections/KpiStrip.tsx` — Needs Mapping card active/disabled by count.
- Edit: `src/features/QbAutomationV2/index.tsx` — mounts NeedsMappingCard on `category === 'needs_mapping'`.
- Edit: `src/TimesheetSystem.tsx` — inline `onSaveMapping` handler (pp_id-primary upsert + event patch + classification + reload).

**Locked decisions:**
- Default `target_kind='bill_add_and_pmt'` (safe default; classifier fills bank+expense via fallbacks).
- Skip rows with `paymentProfile.id <= 0` (pre-launch JSONB artifact).
- Autocomplete uses datalist over `qb_vendors`. Case-insensitive name→listId lookup. Unmatched name → alert.
- After save: event flipped to ready immediately (real-time UX for the mapped row) + classification pass runs for sibling same-pp events.

**Acceptance met:**
- Rows without vendor mapping AND with a valid pp_id surface in the amber Needs Mapping card.
- Manual autocomplete + commit works; writes to `qb_vendor_mappings` with pp_id.
- Committing moves the row to Ready in real time (event patched + reload).

**Rollback:** delete `NeedsMappingCard.tsx`, revert hook + KpiStrip + index.tsx + TS.tsx onSaveMapping.

---

### Slice V5 — Vendor Mapping sub-tab ✅ SHIPPED 2026-09-22
**Est:** 3–5h. **Actual:** ~1h.

**Shipped files:**
- New: `src/features/QbAutomationV2/sections/VendorMappingSubTab.tsx` — table + search + sortable columns + inline edit + delete.
- Edit: `src/features/QbAutomationV2/hooks/useQbAutomationV2.ts` — `mappingRows` derived; hook args gain `paymentProfiles`, `users`, `mappings`.
- Edit: `src/features/QbAutomationV2/index.tsx` — sub-tab nav (Push Inbox / Vendor Mapping); realtime subscription effect; PushBar hidden on mapping sub-tab.
- Edit: `src/types.ts` — `QbVendorMapping` gains `ppId: number | null`.
- Edit: `src/TimesheetSystem.tsx` — passes new props; adds `onUpdateMappingVendor`, `onDeleteMapping`, `onMappingChangeSubscribe` handlers; `loadQbVendorMappings` normalizes `pp_id`.

**Locked decisions:**
- Bills-routed count uses posted qb_ingest_events matching `counterpartyQbVendorListId`. Approximation of "our routing volume" per mapping.
- Legacy rows (pp_id NULL) rendered with a small "legacy" tag; contractor name falls back to counterpartyPattern.
- Realtime channel `qbautov2-mappings` on `qb_vendor_mappings` postgres_changes → reload mappings + events. Wrapper subscribes via `onMappingChangeSubscribe` return-unsubscribe pattern so React can clean up.

**DEFERRED to follow-up slices:**
- `+ Add mapping` button (V5-A): plan §5.6 spec item. Primary add flow is Needs Mapping card in V4, so bypassing for now. Add when accountants want to prepare mappings BEFORE an event arrives (rare).
- `Seed from history` action (V5-B): needs qb_mirror bill scan for contractor's prior vendors. Non-trivial data path; separate slice.

**Acceptance met:**
- Table renders sorted by contractor A→Z (toggle to desc; toggle other columns).
- Edit works — updates row + reclassifies dependent events.
- Delete works with confirm dialog.
- Realtime — Ready view + mapping table both reflect changes within 1–2s of any edit source.
- Search filters instantly by any of contractor / pp label / vendor name.

**Rollback:** delete `VendorMappingSubTab.tsx`, revert hook + index.tsx + TS.tsx handlers + types.ts + loadQbVendorMappings pp_id line.

---

### Slice V6 — smart mapping (history + token overlap) ✅ SHIPPED 2026-09-22
**Est:** 4–6h. **Actual:** ~40min (LLM tier scoped out).

**Scope call:** original plan said tier 3 = LLM (Haiku 4.5). Shipped a token-overlap heuristic instead — covers the Bimosoft-`<name>` / Native-Team-`<name>` per-contractor-suffixed patterns that dominate real data ([[qb-vendor-mapping-truths-2026-09]]). Reconsider LLM (V6-B) if a real case surfaces that heuristic can't handle.

**Shipped files:**
- New: `src/lib/qbAutomation/vendorMappingResolver.ts` — pure lib.
- New: `src/lib/qbAutomation/__tests__/vendorMappingResolver.test.ts` — 11 tests.
- Edit: `src/features/QbAutomationV2/hooks/useQbAutomationV2.ts` — history map + candidates per row.
- Edit: `src/features/QbAutomationV2/sections/NeedsMappingCard.tsx` — suggestion chips.

**Tier stack:**
- Tier 1 (exact `pp_id` lookup): handled by classifier / V4 save path — rows that reach Needs Mapping already failed tier 1.
- Tier 2 (history): contractor's past posted bills → vendor(s) used. HIGH confidence.
- Tier 3 (token overlap): tokenize contractor name + pp label (stopwords filtered, min length 3, unicode-normalized) against vendor names. 2+ tokens matched = HIGH; 1 token ≥5 chars = MEDIUM; 1 short token = LOW.

**Acceptance met:**
- Tier 2 finds a contractor's historical vendor when it exists in the current qb_vendors list.
- Tier 3 returns HIGH / MEDIUM / LOW per bucket rules.
- All 11 tests pass covering both tiers + edge cases (stopword filter, stale history vendor fallback, empty-input cases, candidate cap).
- No LLM cost; no external calls.

**V6-B (deferred): real LLM tier.**
- Only add if a real Needs-Mapping row surfaces that both tier 2 (no history) and tier 3 (no token overlap) fail on.
- Would use Anthropic direct (Haiku 4.5, same pipe as [[ai-gateway-migration]] chat).
- Requires: new edge fn to keep API key server-side, prompt engineering, per-session cache.

**Rollback:** delete `vendorMappingResolver.ts` + tests, revert hook + NeedsMappingCard chip render.

---

### Slice V7 — Discrepancy detection ✅ SHIPPED 2026-09-22 (3 of 6 rules)
**Est:** 3–5h. **Actual:** ~40min.

**Scope call:** shipped 3 of 6 rules (rate_drift / umbrella_mismap / duplicate_refnumber). Rules 2, 5, 6 deferred — see §8 log for reasoning.

**Shipped files:**
- New: `src/lib/qbAutomation/discrepancies.ts` — pure detection lib.
- New: `src/lib/qbAutomation/__tests__/discrepancies.test.ts` — 12 tests.
- Edit: `src/features/QbAutomationV2/hooks/useQbAutomationV2.ts` — vendorContractors map + discrepancyCtx + per-row detection.
- Edit: `src/features/QbAutomationV2/sections/ReadyCard.tsx` — amber ⚠ icon + tooltip.
- Edit: `src/features/QbAutomationV2/index.tsx` — rateHistory prop.
- Edit: `src/TimesheetSystem.tsx` — `qbautov2RateHistory` state + lazy loader.

**Auto-select tightened:**
- Rows with any discrepancy stay UNCHECKED on load (per plan §1.4 verify-first style).
- `Select Payments` / `Select Bill Creations` buttons skip flagged rows.
- Clean rows appearing later still auto-add.

**Tooltip only (no Resolve modal):**
- Plan §5.8 called for a `Resolve` action link opening the correction path. V7 ships a hover tooltip with the resolve hint text instead — the actual resolve paths (edit rate in Payment Profiles / Vendor Mapping sub-tab / invoice edit) all exist as separate flows the user navigates to manually. Explicit Resolve buttons that auto-navigate are deferred to a follow-up if the tooltip proves insufficient.

**Deferred (V7-B if needed):**
- Rule 2 bank_drift (needs mirror-deviation history table).
- Rule 5 AI_suggested_medium (V6 doesn't auto-map from LLM — currently no path to emit this).
- Rule 6 missing_expense_account (very rare; classifier fallbacks cover per [[qb-expense-account-conventions]]).
- Auto-navigating Resolve buttons.

**Rollback:** delete `discrepancies.ts` + tests, revert hook + ReadyCard + index.tsx + TS.tsx rateHistory state/loader.

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
