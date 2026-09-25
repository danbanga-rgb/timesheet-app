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

**State on entry (as of 2026-09-24 S18 EOD — Pushed classifier partially fixed, break called):**
- Branch `feature/qb-automation-v2` tip `a44cde5`. Not merged to main.
- **UNRESOLVED:** synthetic G7.5/G7.6 rows in Pushed card show amber "Pushed + paid outside" incorrectly. See §8 S18 EOD entry for one-line fix + resume prompt.
- Reconciler classifier + 2 prod backfill migrations shipped. Real event labels correct (39 push / 4 manual / 1 qb_probe). Only synthetic row labelling is wrong.
- V1–V9.9 SHIPPED (V7 SCRAPPED; V9.7 shipped-then-killed by V9.8). V8-B CLOSED.
- **Three-bucket model locked** per [[three-bucket-lifecycle]]: Needs Mapping → Ready → Pushed. Anything else is scope creep.
- Reconciler self-heals pp→vendor mappings on data load.
- V9.9 adds: pre-wire `*`-marker suppressed; Inv # column in Ready; persistent Skip via `invoices.qb_export_status`; Pushed history month-grouping; failed-push red pill on Ready with popover + Retry.
- Next up: **V9.10** (Add Columns dropdown). Then **V10** (Sync surface + freshness pills).
- v2 lives at `src/features/QbAutomationV2/` (role-agnostic). Mounted in admin dashboard tab nav as `adminView === 'qbautov2'`.
- **⚠ V8 fires REAL QB pushes on Confirm.** V9.9 Retry button also routes through `onPushRows`. Push queue still held through V12; DO NOT confirm anything via v2 without Dan's go-ahead.
- v1 QB Automation tab is FROZEN — do not touch its render surface.
- Chunk 8 in `.claude/plans/accountant-modularization.md` is SUPERSEDED.
- Modularization arc is PAUSED. Do not resume Chunk 9/10/Phase 6 slices unless Dan asks.

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

**S20 (2026-09-24, evening) — V10 sync surface SHIPPED, then re-shipped after Dan feedback. BREAK CALLED.**

V10 pass 1 (`03e6e0d`): Mirror/Vendors/QBWC pills + `useQbAutoRefresh` (mount + 15-min interval + visibility) + V2-owned PendingJobsInspector modal + `useQbSyncState` hook. Fired auto-refresh on every mount if data was amber/red.

Fixes shipped mid-session:
- `3a8c5fe` — silent mode for `runSyncQbBills`/`runSyncQbVendors` after V1's alerting handlers popped two blocking dialogs on tab open (module-self-sufficient rule extension: even DB-plumbing handlers embed `alert()` for the manual-click case).
- `efc330f` — V10 rethink: pills are indicators, NOT triggers. Killed mount + periodic + visibility auto-refresh entirely. Added single `Sync Now` text link that fires bill + vendor query in parallel. Post-push flow silently refreshes both. `N pending` chip separate from pills → opens inspector.

pg_cron changes applied to prod via Management API:
- `qb-delta-vendors` schedule `37 */2 * * *` → `37 */6 * * *` (jobid 18). Vendor list changes ~1-2/wk; every 2h was 12×/day for near-static data. Bills unchanged at hourly.

Design decisions locked in this session:
1. **Pills are pure status indicators**, not action affordances. No auto-firing from UI.
2. **pg_cron owns cadence**: bills hourly, vendors 6-hourly. UI never duplicates.
3. **Manual override = single `Sync Now` link** that fires both queries. Not two separate buttons per pill.
4. **Post-push refresh** covers the "unless done as part of push" case Dan specified.
5. **V2 self-sufficiency rule** ([[module-self-sufficient]]) extended: even sync handlers get a `silent?` opt because their alert side-effects break silent auto-invocation.

Push queue still HELD through V12. All new writes are query jobs (bill_query/vendor_query), not bill_add/pmt_add.

Branch tip `efc330f`. Not merged to main.

**Next up (§9 roadmap):** V11 (plain-English copy sweep) is next per plan. But might be worth revisiting V9.10 (Add Columns dropdown, deferred) or a different priority Dan surfaces.

**Cold-start resume prompt (paste as first message):**
```
Resume QB Automation v2 arc — S20 closed on break; picking next slice.

═══ COLD-START ORIENTATION (do this first, in order) ═══

1. Read .claude/plans/qb-automation-v2.md §0 Fast Start, then §8 latest
   two entries (S19 + S20). Both were substantive: S19 rebuilt the Pushed
   card to mirror V1's Already Posted columns; S20 shipped V10 sync
   surface then reworked it after Dan feedback.

2. Read MEMORY.md entries in order:
   - [Match V1 during coexistence] — v2 counts + display must match V1
     1:1 while both run.
   - [Pushed row = event, not invoice] — Rule 2026-09-24. Posted-row UI
     fields come from event.counterparty_raw / memo / txn_date, NEVER
     from matched_invoice_ids[0]. Bit us 3× before I stopped reinventing.
   - [Module self-sufficient UI] — Rule 2026-09-24 during V10. V2 owns
     its UI dependencies; even sync handlers need `silent?` opt.
   - [posted_source semantics] — 'push' vs 'manual_accept_fuzzy' vs
     'qb_probe' distinguishes WHO closed a row. Load-bearing.
   - [qb_mirror schema] — column is `entity_ref` (NOT txn_id); vendor
     name/txn_date live inside `data` JSONB. Bit me once when probing.
   - [Three-bucket lifecycle] — Needs Mapping → Ready → Pushed. No new
     buckets.
   - [Break time trigger] — cold-start now; don't wait to be asked to
     re-orient.

3. Confirm `git branch --show-current` returns feature/qb-automation-v2.
   Confirm `git log --oneline -5` shows 5d74951 (S20 plan) at top, then
   efc330f (V10 rework), efc-parent 3a8c5fe (silent mode), 03e6e0d
   (V10 initial), 899d6a5 (S19 plan).

═══ STATE ═══

- Branch tip 5d74951. Not merged to main.
- V1–V10 shipped. V10 pattern: pills are pure indicators, single 'Sync
  Now' text link fires bill+vendor together silently, post-push refreshes
  both, `N pending` chip opens inspector. Auto-refresh (mount/periodic/
  visibility) intentionally REMOVED per Dan.
- pg_cron in prod: qb-delta-bills hourly at :17, qb-delta-vendors every
  6h at :37 (changed from 2h this session via migration 20260924000002,
  applied via Management API — jobid 18 verified).
- Pushed card columns: Src | Date | Counterparty | QB Vendor | Amount |
  Memo | Action | Posted at. QB Vendor cell shows 'same QB vendor'
  italic muted-green when it equals Counterparty (Intuit passthrough).
  Synthetic G7.5/G7.6 rows synthesize event-shape fields.
- Shared lib grew: src/lib/qbAutomation/pushedRowDerivation.ts (V1 also
  consumes at V12 cutover).
- V2 lives at src/features/QbAutomationV2/ — role-agnostic module,
  mounted in admin dashboard as adminView === 'qbautov2'.
- Reconciler self-heals pp→vendor mappings on data load.
- Push queue is HELD through V12 per Dan's decision. V10's 'Sync Now'
  only writes bill_query/vendor_query jobs (safe reads), never
  bill_add/pmt_add.

═══ 🛑 HARD RULES ═══

- Do NOT push any bill_add / bill_pmt_add / check_add live. Query jobs
  only. Push queue held through V12.
- Do NOT touch v1's QB Automation tab render (frozen until V12 cutover).
- Do NOT re-add mount-time or periodic auto-refresh. Killed intentionally.
- Do NOT introduce invoice-derived fields on Pushed rows. Use event
  fields (counterparty_raw, memo, txn_date, source).
- Do NOT rewrite pushedRowDerivation lib without confirming Dan is OK
  with the change ripples to V1 (which will consume at V12).
- Do NOT introduce a new provenance/match chip on Pushed. Match column
  was intentionally dropped per Dan.

═══ NEXT UP (Dan picks) ═══

Three candidates queued in §9 roadmap; ask Dan which:

- V11: plain-English copy sweep (§5.10 in this doc). Red-line pass on
  every user-facing string. Dan reviews each one. Est 1-2h.
- V9.10: Add Columns dropdown for Ready row customization. Deferred
  from S17. LocalStorage persistence. Est ~2h.
- Something else Dan surfaces at session open (e.g. address one of the
  open concerns: rebuilding the Reconciler improvements after Rumiya
  fuzzy incident, or vendor 6h cadence review, or hint bar UX).

═══ WORKFLOW ═══

1. Do orientation reads (steps 1-3 above).
2. Ask Dan one line: "V11 copy sweep, V9.10 Add Columns, or something
   else?"
3. Once he picks, plan the slice (present tradeoffs if any), get
   approval, ship in a small commit, push to preview.
4. Log the slice to plan doc §8 as S21.

═══ FIRST ACTION ═══

Do orientation reads. Then ask Dan the one-line pick question. Do NOT
start coding anything until Dan chooses.
```

---

**S19 (2026-09-24, afternoon) — Pushed card rebuilt on V1's columns. SHIPPED `27702f4`.**

Two commits earlier in session (`dcf0da4` synthetic-row label fix, `856b3ca` shared derivation lib for Action + Match chips) were incremental wins on the wrong path. Dan pushed back midway: the Pushed card was showing invoice-derived fields (Contractor, Period, Inv # from `matched_invoice_ids[0]`) as if authoritative — misleading on fuzzy matches. Rumiya's row read "INV 11 | paid: Inv# 09" because the reconciler had fuzzy-matched event 88 (memo "Inv# 09") to invoice 181 (INV 11) via amount+vendor+date.

Investigation via probe (`/tmp/probe-rumiya*.mjs`) confirmed:
- `posted_source='manual_accept_fuzzy'` — accountant paid Inv# 09 in QB pre-cutover; we didn't push anything
- Our INV 09 (invoice id 25) is `matcher_ignore=true`, so fuzzy matcher fell through to INV 11 (next-closest $9,625 approved invoice)
- We did NOTHING WRONG. The DB is correct; the UI was rendering fuzzily-matched invoice fields as if they were source-of-truth.

Rebuild scope (`e8fce68`):
- `PushedRow` reshape — dropped `contractorName`, `invoiceNumber`, `monthKey`, `monthLabel`, `matchProvenance`. Added `src`, `date` (event txnDate), `counterpartyRaw`, `memo`. Row reads event fields directly, never substitutes invoice fields.
- 8 columns matching V1's Already Posted (TS.tsx:8599-8611) minus Provenance: **Src | Date | Counterparty | QB Vendor | Amount | Memo | Action | Posted at**
- `text-[11px]` + `px-1.5` + zebra rows + subtle column dividers for single-tight-row scan density
- QB Vendor cell renders `same QB vendor` italic muted-green when Counterparty ≈ QB Vendor (Intuit passthrough case, ~18% of rows)
- Synthetic G7.5/G7.6 follow V1's synth pattern (TS.tsx:7461-7488): construct event-shaped fields so real + synthetic pushes share one render path
- Ellipsis truncation on Counterparty (195px) / QB Vendor (235px) / Memo (150px) with hover tooltip for full text

Follow-up nits (`27702f4`):
- Posted at "Sep 17 at 10:09 AM" → "9/17 10:09a" (year implicit in month header)
- Src labels "Invoice → Bill (X)" → "Inv → Bill (X)"
- Freed width redistributed to Counterparty/QB Vendor

**Meta lesson (session): V1's Already Posted column choices were correct all along. Two prior commits (`dcf0da4`, `856b3ca`) tried to preserve the wrong shape (invoice-derived fields + Provenance column). Dan called it out three times before I stopped reinventing. New guardrail memory: [[pushed-row-event-not-invoice]].**

**Prod state at S19 close (safe):**
- Branch tip `27702f4`. Not merged to main. Push queue still HELD through V12.
- V2 Pushed count: 103 rows / $655,863 — matches V1 exactly.
- No new migrations. No pushes fired.

**Also open (deferred, low priority):** Rumiya fuzzy row 88 exposed a real reconciler quirk — when a memo names an invoice that's `matcher_ignore=true`, fuzzy falls through to the next amount-match. Not a data integrity bug (posted_source='manual_accept_fuzzy' correctly flags accountant-side), but a matcher improvement candidate. Not scoped here.

---

**S18 EOD (2026-09-24) — BREAK CALLED (Dan frustrated). V9.9 items shipped + Pushed classifier followups partially shipped. Unresolved: synthetic row labelling still wrong.**

**Remaining bug at break — Pushed card synthetic rows show "Pushed + paid outside" incorrectly.**

Screenshot Dan sent at break: dozens of Convera Sep 3 rows labeled amber "Pushed + paid outside." These are the SYNTHETIC G7.5/G7.6 invoice-driven rows added by commit `4566e28`. Their label is computed at render time in `derivePushedByMonth` as:
```
postedSource = inv.status === 'paid' ? 'push_paid_outside' : 'push'
```
This is wrong per Dan's rule ([[intuit-double-booking-finding]] + earlier session dialog): "Even if we sent old payments to WU Holding and accountant corrected them to 8220, the fact is, we pushed it." We pushed the CREATE for these invoices. Accountant paying them (via Pay Bill from 8220) doesn't demote the label — WE still pushed.

Two possible fixes for next session (pick one, don't do both):
1. **Always label synthetic G7.5/G7.6 rows as `push`.** Simplest — drop the `inv.status === 'paid'` check. Rationale: synthetic rows ARE our create-bill push per definition (they only exist because we drained bill_add). Payment status is orthogonal and already captured by the real event row if present.
2. **Dedupe synthetic rows against real posted events.** V1 concats without dedup, but V1 has no chip labels so the duplication is invisible. V2 with chips makes the duplication visible + confusing. Adding dedup means V2 count would drop below V1 (violating [[match-v1-during-coexistence]]) — probably NOT the right call.

Recommend fix #1. Ship as one small commit, then re-verify against V1 screenshot.

**Also open (lower priority):** the 4 Intuit `manual_accept_fuzzy` rows show as "Manual." Those are duplicates in the ingest stream where accountant fuzzy-matched an existing QB bill. Labeling is technically correct but Dan initially expected them to say "Pushed" — worth confirming his acceptance in a follow-up sentence, not a code change. Same for the 1 remaining `qb_probe` (Fix-It Sep 15 wire not yet pushed).

**Prod state at break (safe):**
- Reconciler classifier + 2 backfill migrations shipped. posted_source distribution now: 39 push / 4 manual_accept_fuzzy / 1 qb_probe / 0 push_paid_outside. Correct.
- Branch tip `a44cde5`. Backfills 20260924000000 + 20260924000001 applied to prod via Supabase Management API.
- V2 Pushed card shows 103 rows matching V1's 103. Numbers match. Only chip labeling on synthetic rows is wrong.
- Push queue still HELD through V12. None of the S18 EOD work fires new pushes.

**Cold-start resume prompt for next session** (paste as first message):
```
Resume QB Automation v2 arc — fix synthetic-row chip labelling.

Read .claude/plans/qb-automation-v2.md §8 latest entry (S18 EOD). Confirm
branch `feature/qb-automation-v2`, tip `a44cde5`. Push queue still HELD
through V12; do NOT push anything live.

One-line fix: in src/features/QbAutomationV2/hooks/useQbAutomationV2.ts
derivePushedByMonth, synthetic G7.5/G7.6 rows unconditionally set
postedSource = 'push'. Drop the inv.status === 'paid' check — WE pushed
the create; payment status is orthogonal (Dan's [[intuit-double-booking-
finding]] rule).

Update the "marks G7.5/G7.6 rows as push_paid_outside when invoice is paid"
test to assert 'push' instead. Small commit. Push preview. Verify against
V1 screenshot: all 103 rows should show either "Pushed" (green) or "Manual"
(slate). ZERO amber "Pushed + paid outside" for the current data.
```

**S18 (2026-09-24, morning) — V9.9 SHIPPED (5 items, 5 commits `c840f73` → `ad79da2`).**
- Item 1 (`c840f73`) — drop `*` marker on pre-wire umbrella children. Widened `UmbrellaChildRow.shareSource` union with `'pre_wire'`; loose-invoice group branch uses it. Render sites already gate on `=== 'invoice_total'`, so no card changes needed.
- Item 2 (`833b469`) — dedicated **Inv #** column in Ready between Period and QB Vendor. Solo rows show `inv.invoiceNumber`; group parents show em-dash; child rows keep the number in the new column instead of borrowing the Period slot. New `'inv'` SortKey with numeric-aware string sort. Header + parent + child cells preserved at 10 columns.
- Item 3 (`b5d20f3`) — persistent Skip via `invoices.qb_export_status='skipped'`. Session-local `skippedKeys` was a regression from v1 (forgotten on reload). Hook derives `skippedInvoiceIds` from `invoices`; a row is skipped iff every underlying invoice is skipped. `skip/unskip` become async and call new `onSaveInvoiceExportStatus` prop wired to v1's `saveInvoiceExportStatus` wrapper.
- Item 4 (`91d0bbd`) — Pushed history month-grouping. New `derivePushedOlderByMonth` pure fn + `buildPushedRow` helper (DRYs today/older paths). `PushedTodayCard` gains an "Older" section under the today table, one collapsible row per local push-month, sorted newest-first.
- Item 5 (`ad79da2`) — failed-push badge on Ready. New `FailedPushJob` type; `ReadyRow.lastFailedPush`. Hook indexes by source event/invoice, taking the most recent per source. Red pill next to verdict opens a popover with job id, kind, timestamp, error message, and a Retry button. Retry re-enqueues via `onPushRows` for just this row's IDs (bypasses preview modal) then reloads the inbox. TS.tsx loads recent failed jobs (last 30d, capped 200) alongside events.
- **Push queue still HELD through V12.** Retry re-enqueues through the same `onPushRows` contract; nothing new is live-pushed by V9.9.
- Tests: 69/69 pass. `npm run build` clean. Preview: [preview URL from S17].
- Next: V9.10 (Add Columns dropdown) — deferred per S17 log. Then V10 (Sync surface + freshness pills).

**S17 EOD (2026-09-23) — V9.5c/d, V9.6/b, V9.7 (killed by V9.8), V9.8 shipped. Break called.**

**V9.8 (`8746b2d`) — collapse to Dan's three-bucket lifecycle.** After V9.7 shipped a NeedsAttention KPI + card, Dan pushed back hard: "over engineering," "vague/inconsistent," "why is this so hard." The right model per [[three-bucket-lifecycle]]: `Needs Mapping → Ready → Pushed`. Nothing else.
- Deleted `buildUmbrellaVendorSet` + `isUmbrellaVendor` + "hide slice pre-wire" filter (V9.5 Part B was scope creep). False positives on Davor (3 pps → AFTER SEVEN), Boris (2 pps → LION TESTING LABS), Branimir (2 pps → OKTAXART) were the tell.
- Deleted NeedsAttentionCard + KPI tile + NeedsAttentionRow type. Actionable sub-reasons folded into NeedsMapping with per-reason inline fix.
- Ready loose-invoice loop groups by `(qbVendorListId, monthKey)`. Bucket >1 → pre-wire umbrella group row. Bucket ==1 → solo row.
- Test-account filter (`isTestAccount`) applied to Ready + Needs Mapping.
- KpiStrip: 5 → 4 tiles.
- [[umbrella-two-signal-design]] marked partially obsolete.

**V9.7 (`d4cafe3`) — SHIPPED THEN KILLED.** NeedsAttention KPI + card with 4 reasons. Whole slice reverted by V9.8. Kept in git as archaeology of what NOT to do.

**V9.6b (`723f3e1`) — reconciler timing fix.** V9.6 gated inside `loadQbVendorMappings` on `paymentProfiles.length > 0 && qbVendorsList.length > 0`. Fires before state populates → guard skips → reconciler never runs. Hoisted to `useEffect` keyed on `[paymentProfiles, qbVendorMappings.length, qbVendorsList.length]`.

**V9.6 (`e35a7d4`) — self-healing pp→vendor mapping reconciler.** `src/lib/qbAutomation/ppMappingReconciler.ts` + tests. Detects pps with `qb_vendor_name` set matching a real `qb_vendors` row but no mapping. Auto-inserts. Fixes Harun + 26 others invisible in Ready.

**V9.5d (`d39fa72`) — don't drop umbrella group when verdict input is thin.** Group row used `refNumber=''` → `computeVerdict` returned null → skip. Fixed with first-child ref + `?? 'will_create_and_pay'` fallback.

**V9.5c (`f010d79`) — TS.tsx umbrellaShares data feed.** V9.5b hook was right; TS.tsx build filtered through `matched_invoice_ids` before writing to the Map, silently dropping siblings. Fixed: iterate ALL `convera_transaction_invoices` rows.

**Hotfixes to main during S17:**
- PR #13 (`7a130ec`) — approve trusts `invoice.paymentProfile` snapshot + SWIFT optional + invoice-edit trigger migration.
- PR #14 (`ae3cd4a`) — cross-contractor payment profile picker in InvoiceDetailModal.
- Reclassify sweep applied (Nejra/Predrag/Deniz).
- Iskra pp 102 Teal mapping backfilled.
- Ajdin invoice #306 backfilled with Faruk's snapshot.

**V9.9 scope (agreed at break):**
1. Drop `*` marker on pre-wire umbrella children (no convera link possible pre-wire; marker means nothing).
2. Add **Inv #** column to Ready (dedicated column between Period and QB Vendor). Solo rows show the number; group parent rows show `—`.
3. Persistent Skip via `invoices.qb_export_status = 'skipped'` (v1 pattern via `saveInvoiceExportStatus`; current v2 uses session-local state — a regression).
4. Pushed history month-grouping (v1-style rollup for older rows). One combined `Pushed` bucket, not separate today+historical.
5. Failed-push badge on Ready rows: read `qb_sync_jobs.status='error'` linked to event/invoice → red pill "Last push failed — [reason]" with retry.

**V9.10 (deferred):** Add Columns dropdown for user-customizable Ready column set (Provenance, Src, Payment method, QB Ref, Push status, etc). LocalStorage persistence.

**S17 (2026-09-23, morning) — V8-B items 4 + 5 shipped. V8-B CLOSES. V9 shipped. V9.5 shipped (umbrella group rendering).**

**V9.5 (`4d9259c`) — Umbrella group rendering + hide slice-invoice for umbrella vendors.**
- Fixes two related bugs Dan surfaced from preview screenshots:
  - Teal Crossroads $37,400 wire attributed only to Strahinja (`matchedInvoiceIds[0]` — other 7 slices invisible).
  - Strahinja's Aug slice showing standalone "Will Create Bill" before the wire lands (semantically wrong — QB books one Bill for wire total).
- New `src/lib/qbAutomation/umbrella.ts` with two independent detection signals, documented in [[umbrella-two-signal-design]]:
  - `isUmbrellaEvent(event, invoicesById)` — matched invoices span >1 distinct userId → group render.
  - `buildUmbrellaVendorSet(mappings)` — vendor mapped by >1 pp → hide invoice slice.
- Impact-checked cases (Dan explicitly asked to verify):
  - Teal (1 vendor, 8 pps): both signals fire. ✅ group render + Aug hidden.
  - Bimosoft (N per-contractor vendors): event-only fires. ✅ group render for wire, per-contractor "Will Create Bill" preserved.
  - Native Teams: same as Bimosoft. ✅
  - Faruk-covers-Ajdin (2 contractors): event-level always fires; vendor-level fires only if Ajdin has separate pp. ✅ either way group render is correct.
- Group row structure: parent shows wire total + vendor (or "N vendors" for multi-vendor umbrellas) + contractor-count chip + verdict. Sub-rows on expand show per-contractor invoice #, hrs, rate, share (from `convera_transaction_invoices.amount_share`, fallback to invoice total with `*` marker). Selection + Skip parent-level only.
- Preview modal defaults groups to expanded so accountant sees full breakdown before confirming.
- TS.tsx: new `qbUmbrellaShares` Map loaded in `loadQbIngestEvents` by joining events → convera_transaction_id → convera_transaction_invoices.
- 16 new tests around umbrella detection. Total 64/64 pass.
- **Separate memory saved:** [[classifier-pending-only-guard]] — discovered while diagnosing the Nejra Jul row. `classifyOne` only runs on `status='pending'`, so historical mapping fixes don't propagate to already-classified 'ready' events. Motivates the reclassify sweep next.
- Next: reclassify sweep script for Nejra/Predrag/Deniz stale event classifications, then V10.

**V9 (`bb64388`) — Pushed Today card + KPI tile enabled.**

**V9 (`bb64388`) — Pushed Today card + KPI tile enabled.**
- New `sections/PushedTodayCard.tsx` — sortable table of today's `qb_ingest_events` with `status='posted'` filtered by `statusUpdatedAt` >= local midnight. Sorted newest first; TxnID badges (Bill / Pmt / Chk) are click-to-copy; posted_source tag visible.
- New `derivePushedTodayRows` pure fn + `todayLocalDateKey` / `localDateKeyOfIso` helpers in the hook — 9 new tests around filter, sort, fallback, and DST-safe local-date bucketing. Total 48/48 pass.
- KpiStrip tile enabled with real count + total; click jumps to the card.
- **Simplifications from the §9 spec:**
  - SkippedCard.tsx extraction skipped — Skipped view already routes to `ReadyCard` with `category==='skipped'` and passes the acceptance criterion (Skip/Unskip roundtrip works). Per [[reusability-lens]] — no net LOC win from extracting for symmetry alone.
  - Failed-rows subsection deferred per [[small-userbase-pragma]] — QbPushStatusPane already surfaces session-level failures with error text; failed rows stay in Ready for retry (event status doesn't flip to 'failed' on job error, per QBWC edge fn behavior). Persistent failure history can land later if the accountant asks.
- **Next:** V10 (Sync surface + freshness pills) per §9 roadmap.



**Item 5 (`e37aeda`) — post-push sync + refresh hint.**
- After successful push, v2 fires a silent `enqueueVendorQuery` (no user-facing alert) so QBWC picks up any newly-referenced vendors on its next drain. A hint bar appears above the KPI strip: "Vendor sync is running in the background (~15 min). Refresh once QBWC drains to pick up any newly-resolved rows." Refresh button reloads events + open bills.
- Design tradeoffs settled with Dan first:
  - **Q1 = (a) auto-run Sync Vendors + Sync Mirror after push.** Per §5.11 step 5; matches item 3 pattern. Called silently via new `onPostPushSync` prop.
  - **Q2 = (a) hint bar, kept minimal.** Dan pushed back on aggressive auto-select-and-reopen-modal because new resolvables are rare with our contractor pool. Hint's only action is Refresh — no snapshot-diff, no delta detection, no auto-selection. Cheap, obvious, dismissable.
  - **Q3 approved as-designed** (would have been snapshot-diff — replaced by simpler refresh model).
- Two new props: `onPostPushSync: () => Promise<void>` (fire-and-forget) + `onRefreshInbox: () => Promise<void>` (parent-owned reload). TS.tsx wires them to `enqueueVendorQuery` and `loadQbIngestEvents + loadQbOpenBills`.
- No new tests needed — the hint is pure render logic gated on `showPostPushHint` state.

**Item 4 (`a5e3d20`) — cancel pending pushes.**
- Per-row + batch Cancel on QbPushStatusPane. New `src/lib/qbAutomation/cancelPushJobs.ts` — flips `qb_sync_jobs` pending→skipped with pending-only guard (so QBWC in-flight writes are never touched), then reverts event-sourced `qb_ingest_events.status` to 'ready' when the pay job was actually cancelled. Invoice-sourced G7.5 records skip the event revert.
- Design decisions locked with Dan first (Q1–Q4 from S16):
  - **Q1 = (c) both** — DB flag + client hide. Uses existing `'skipped'` enum value; no migration.
  - **Q2 = (c) both** — per-row `cancel` link + batch `Cancel remaining (N)` header button.
  - **Q3 = flip to 'ready'** — cancelled = "not now, not never." Event re-appears in Ready card; no orphaned 'queued' rows. Guard skips events already in 'ready'/'posted'.
  - **Q4 = best-effort + pending-only SQL guard** — cancel is a no-op if QBWC already flipped the row to 'in_flight'. UX banner reports the split: `Cancelled N pending · M already in flight (will complete)`. Per [[inline-controls-over-warnings]].
- 8 new tests in `src/lib/qbAutomation/__tests__/cancelPushJobs.test.ts` — covers empty input, pay+verify job cancel, in-flight guard, event revert logic across 3 states (queued/ready/posted), invoice source non-touch, missing verify job, event ID dedup, DB error propagation. Total 39/39 pass.
- Only wired into v2 (`onCancel` prop is optional; v1 pane render unchanged).
- Push queue STILL HELD. Dan verifies on preview → next session picks up item 5 (phase 2 re-push after post-push sync).

**S7 (2026-09-18, PM) — pivot session.**
- STOP GATE reached at end of S6 after IB slice merged (`801b080`).
- Dan chose Path 3 (rebuild UI, keep plumbing).
- Locked: v1 frozen; v2 ground-up at `src/roles/Accountant/tabs/QbAutomationV2/`; admin-gated; reuse plumbing + design language from QbExport modal.
- Chunk 8 in `.claude/plans/accountant-modularization.md` marked SUPERSEDED.
- Memory saved: [[qb-automation-v2-pivot]]. [[qb-automation-stop-gate]] marked RESOLVED.
- Next: Dan gives directionality → Claude asks questions → §5 sections + flows populated → v2 spec locks → code starts.

**S16 (2026-09-22 afternoon) — V8-B items 1, 2, 3 shipped.**
- **Item 1 (`703a743`)**: inline QB vendor override in Ready rows. Click any QB vendor cell → autocomplete with tier-2/3 suggestion chips → Save mapping. Save-as-mapping only per Dan's Option A ("pp is 1:1 with contractor; even if pp changes it normally routes to a different QB vendor; very very rare for different pp to hit same QB vendor"). Per-push override deferred. New component: `InlineVendorPicker.tsx`. `SaveMappingArgs.eventId` now nullable (invoice-driven rows have no event to flip). 10 new tests → 31/31 pass.
- **Item 2 (`9fedc05`)**: Preview modal picks up inline vendor edits. Same click-to-edit cell in the modal row table, same InlineVendorPicker, same onSaveMapping handler. Row updates in place after save (via classifier repass → hook rebuild). Editing disabled while push is in flight (`busy`).
- **Item 3 (`8cba758`)**: preflight banner + Sync Vendors button in Preview modal. Any selected row whose target vendor listId is not in the `qb_vendors` mirror surfaces an amber banner + row highlight + "Not synced" chip. Confirm is blocked; user can Sync Vendors (enqueues vendor_query; drains via QBWC ~15 min) OR re-map affected rows inline to a vendor already in the mirror. Banner disappears automatically when mirror refreshes. ReadyRow gained `qbVendorListId: string | null` for mirror-membership check. New prop `onSyncVendors` wired to TS.tsx `runSyncQbVendors`.
- **Remaining in V8-B:** item 4 (cancellation on QbPushStatusPane) + item 5 (phase 2 re-push). Design questions for item 4 — see §9 V8-B "Open questions for item 4" section.
- Push queue STILL HELD. Dan resumes at item 4 next session.

**S15 EOD (2026-09-22, session pause).** Marathon session shipped V2, V3, V3.1, V4, V4.1, V5, V5.1, V5.2, V5.3, V5.4, V6, V7 (scrapped), V8. Two new memories saved: [[inline-controls-over-warnings]] (durable rule) + [[rate-history-seeded-not-populated]] (data trap). Pivot memory updated with tip commit `6cfb25a` and V8-B deferred section. Push queue STILL HELD. Dan resumes for V8-B next session — see §9 V8-B entry (dedicated) for the fresh-session pickup pointer.

**S15 (2026-09-22) — Slice V8 shipped: real push flow + Preview modal + status pane.**
- New `PushPreviewModal.tsx` — shows selected rows before commit with per-verdict counts + totals, Confirm/Cancel. Modal blocks background clicks while pushing.
- New `onPushRows({eventIds, invoiceIds})` wrapper handler distills v1's TS.tsx:7660+ routing logic into a single call. Routes to 8 pushers: pushIntuitPayBill, pushIntuitCreateBill, pushIntuitInvoiceCreateBill (G7.5), pushConveraInvoiceCreateBill (G7.6), pushConveraBillPmt (C-1), pushConveraCreateBillAndPay (C-2/C-3), pushConveraCreateBillFromEvent (C-4). Invoice-driven rows (will_create_bill) route by paymentMethod → G7.5/G7.6 pushers.
- QbPushStatusPane mounted inside v2 inbox view. Shares session-level `qbPushRecords` state with v1 — both surfaces see the same in-flight/verified/failed rows. Consistent audit trail.
- Push flow: select rows → PushBar → Preview modal → Confirm → parallel pusher fan-out → merged result → alert summary + status pane records → clearSelection + snap to Ready + reload events + openBills.
- Only pay_bill jobs get status-pane records (v1 policy; bill_add-only pushes track via event.resolved_bill_txn_id flip + recompute).

**V8 deferred to V8-B:**
- Inline QB vendor override per Ready row (autocomplete + save-as-mapping) — the actionable-controls ambition from the V7 discussion.
- Preflight auto-sync (Sync Vendors if missing).
- Cancellation (mid-push stop).
- Phase 2 re-push (rows newly resolved by phase 1's sync).

**S14 (2026-09-22) — Slice V7 SCRAPPED.** See §9 V7 entry for reasoning + revert commit `b030f01`.

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

### Slice V7 — Discrepancy detection ❌ SCRAPPED 2026-09-22

**Attempt shipped and reverted the same session.** Three rules were built (rate_drift, umbrella_mismap, duplicate_refnumber). All three had reliability or design problems:

- **rate_drift**: `rate_history` was seeded with only the *latest* rate per user (backfill note "Seeded from most recent invoice at migration time"). It's a snapshot pretending to be history — comparing older invoices against today's rate → constant hallucinated drift.
- **duplicate_refnumber**: false-positives on umbrella vendors (Teal Crossroads). Different contractors sharing an umbrella vendor + coincidentally similar invoice numbers → cross-contractor collisions flagged as dupes.
- **umbrella_mismap**: fires perpetually on every Teal row (Teal is a legitimate multi-contractor vendor). Would only add signal if a new umbrella emerged unexpectedly — vanishingly rare.

Deeper reason it didn't work: **hover tooltips are homework assignments, not controls.** Even if the rules were clean, they couldn't drive action — the IIF Export modal Dan referenced works because it makes the fix *inline*. Discrepancy detection needs to be inline-actionable or it's noise.

Reverted in the same session. The inline-controls ambition rolls into V8 (per-row QB vendor override + Hold + Push Preview modal — see V8 entry).

Original spec preserved below for archaeology.

<details>
<summary>Original V7 spec (pre-scrap)</summary>

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

</details>

---

### Slice V8 — Push flow + Preview modal + status pane ✅ SHIPPED 2026-09-22
**Est:** 4–6h. **Actual:** ~50min for the core; V8-B holds the inline-controls ambition.

**Shipped files:**
- New: `src/features/QbAutomationV2/sections/PushPreviewModal.tsx` — preview + Confirm/Cancel.
- Edit: `src/features/QbAutomationV2/index.tsx` — modal state + push handler wiring + status pane mount.
- Edit: `src/TimesheetSystem.tsx` — `onPushRows` inline handler (routes to 8 pushers) + push records prop.

**Push routing (mirrors v1 TS.tsx:7660+):**
- Intuit XLSX events by resolvedAction → pushIntuitPayBill / pushIntuitCreateBill / pushIntuitCheck (check excluded by Ready filter, so unused here).
- Convera events: 1-invoice + bill exists → pushConveraBillPmt; >1 invoice or missing bill → pushConveraCreateBillAndPay; orphan (no invoice) → pushConveraCreateBillFromEvent.
- Invoice-driven rows (will_create_bill) → G7.5/G7.6 pushers by paymentMethod (Intuit vs Convera).
- All 8 fire in parallel via `Promise.all`, results merged.

**Post-push:**
- Alert with counts (pushed / rejected / duplicate-skipped / ineligible).
- Status-pane records added for pay_bill jobs; bill_add-only pushes are observable via event resolved_bill_txn_id flip.
- clearSelection + setCategory('ready') + reload qbIngestEvents + qbOpenBills.

**Acceptance met:**
- Push CTA opens preview.
- Preview shows per-verdict counts + amounts + row table.
- Confirm fires real pushes via existing v1 handlers.
- Status pane surfaces in-flight/verified rows.
- Rows disappear from Ready after next reload as their status flips.

**V8-B (deferred):** see dedicated §9 entry below.

**Rollback:** delete `PushPreviewModal.tsx`, revert `index.tsx` push flow additions + status pane mount, revert `TS.tsx` onPushRows handler + pushRecords prop.

---

### Slice V8-B — Inline controls + preflight + cancellation
**Est:** 4–6h. **Depends on:** V8. **Priority:** high — Dan called this out during V7 discussion.

**Progress (2026-09-22 S16):**
- ✅ Item 1 shipped (`703a743`) — inline vendor override in Ready rows, save-as-mapping only.
- ✅ Item 2 shipped (`9fedc05`) — Preview modal picks up the same click-to-edit + inline picker.
- ✅ Item 3 shipped (`8cba758`) — preflight banner + Sync Vendors button + Confirm-block when any selected vendor is missing from mirror.
- ✅ Item 4 shipped (`a5e3d20`, S17 2026-09-23) — per-row + batch Cancel on QbPushStatusPane. Backed by `src/lib/qbAutomation/cancelPushJobs.ts` (pending-only guard on `qb_sync_jobs`; revert event to 'ready' when pay job cancelled; invoice-source records skip event revert). 8 new tests → 39/39 pass. Design Qs 1–4 resolved per S17 log entry above.
- ✅ Item 5 shipped (`e37aeda`, S17 2026-09-23) — post-push silent Sync Vendors + refresh hint bar. `onPostPushSync` fire-and-forget prop + `onRefreshInbox` reload prop wired from TS.tsx. Simplified per Dan's guidance ("new resolvable rows rare with our userbase") — no snapshot-diff, no auto-select. V8-B CLOSES.

**Open questions for item 4 (surface before coding):**
1. **What does "cancel" mean at the semantic level?** Options:
   - (a) Flag pending `qb_sync_jobs` rows so QBWC skips them on next poll. Only affects rows not yet in-flight.
   - (b) Client-only visual dismissal (remove records from `qbPushRecords` state without touching the queue). Simpler but doesn't stop QBWC from firing them.
   - (c) Both: DB flag + client hide. Cleanest but requires new column on `qb_sync_jobs` or a status transition.
2. **Where does the Cancel button live?** Options:
   - (a) Per-record inline in `QbPushStatusPane` (each pending row gets a Cancel).
   - (b) Global "Cancel remaining" button at the top of the pane, cancels ALL pending in the batch.
   - (c) Both.
3. **Does cancel touch `qb_ingest_events.status`?** If a `pay_bill` job is cancelled before firing, the underlying event stays in `status='ready'` — should it flip to `skipped`? Or stay ready for a retry?
4. **QBWC race condition:** if QBWC picks up a job at second T, and Cancel writes at T+1ms, is there a guardrail? Or do we accept "cancel is best-effort — in-flight writes complete"?

**Recommend Dan chooses option per Q before I code.** Per [[inline-controls-over-warnings]] — the cancel button MUST come paired with clear feedback ("cancelled 3 pending, 2 already in flight") — no ambient warnings.



**Goal:** ship the actionable-controls ambition that killed V7. Every "the mapping might be wrong" or "we don't have this vendor synced yet" case gets an inline fix path in the Ready row or the Push Preview modal — no navigation, no tooltips.

**Files to create:**
- `src/features/QbAutomationV2/sections/InlineVendorPicker.tsx` — small inline autocomplete widget for per-row vendor override. Reuse `QbVendorNameEditor` if it fits, or build fresh.
- Possibly: `src/features/QbAutomationV2/hooks/useQbPreflight.ts` — encapsulates missing-vendor detection + auto-sync-then-retry flow.

**Files to edit:**
- `src/features/QbAutomationV2/sections/ReadyCard.tsx` — QB Vendor column becomes click-to-edit. Two behaviors on save:
  - **Save as mapping** (default) — writes to `qb_vendor_mappings` via existing `onSaveMapping` (pp_id-primary); rows dependent on this pp update via classification pass.
  - **Just this push** (secondary) — session-only override, applied at push time via a `perPushVendorOverride: Map<rowKey, listId>` state.
- `src/features/QbAutomationV2/sections/PushPreviewModal.tsx` — same inline vendor override per row before commit. Also: preflight banner if any selected row's target vendor is missing from `qb_vendors`. "Sync Vendors + retry" button.
- `src/features/QbAutomationV2/index.tsx` — push flow honors `perPushVendorOverride` when building the eventIds/invoiceIds payload; preflight banner state.
- `src/TimesheetSystem.tsx` — expose `runSyncQbVendors` as a prop to v2 for the preflight retry button.
- Possibly `src/components/QbPushStatusPane.tsx` — add a Cancel action (needs new `qb_sync_jobs` cancellation semantics — separate investigation before we touch this).

**Acceptance:**
- Click on a QB Vendor cell in Ready → autocomplete opens inline. Save-as-mapping persists (updates classification for future events); Just-this-push applies only to the current selection.
- Push Preview modal shows the (potentially overridden) vendor for each row.
- If any selected row's target vendor is missing from `qb_vendors` mirror, preflight banner in the modal offers "Sync Vendors" — clicking runs Sync + reloads + re-evaluates.
- Cancellation: mid-push, user can click Cancel in the status pane → any pending queue rows get flagged as cancelled (does NOT reverse in-flight QB writes — that's not possible).
- Phase 2 re-push (nice-to-have): after post-push sync, if any Needs Mapping rows have become auto-resolvable, offer a second push in a small hint bar.

**Order of operations for the coding session:**
1. Inline vendor override in Ready rows (biggest UX unlock; unblocks the rest).
2. PushPreviewModal picks up the override.
3. Preflight banner + Sync retry.
4. Cancellation.
5. Phase 2 (if time).

**Rollback:** delete new files; revert edits to ReadyCard / PushPreviewModal / index.tsx / TS.tsx.

**Cold-start read order:** §0 → this entry → [[qb-automation-v2-pivot]] (V8-B deferred sub-slices section) → [[inline-controls-over-warnings]] (why this ambition exists) → §5.11 (push flow spec) → §8 session log for V8 shipped state.

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
