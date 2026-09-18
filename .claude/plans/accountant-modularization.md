# Accountant Modularization — Multi-Session Planning Doc

**Started:** 2026-09-15
**Owner:** Dan (decisions) + Claude (analysis/carve-outs)
**Nature:** Discovery + planning. **No code changes** in these sessions.
**Deliverable:** ordered, buy-off-ready slice list where each slice has: purpose, dependencies, carve-outs, behavior-locking check, effort estimate.

---

## 1. How to use this doc across sessions

- Single source of truth. On cold-start, read §2 (guardrails) → §5 (status table) → §6 (last active chunk) before doing anything.
- End of every session: update §5 status column, §6 pointer, §8 session log. Save any non-obvious decision to MEMORY.md.
- Doc + memory carry state. If we deviate, log it in §7.
- Living map (§4) is verified against real code each time we return, not trusted stale.

### 1a. FAST START — Arc analysis complete; ready to execute

**Status as of 2026-09-15 EOD (S1):** Planning arc COMPLETE. 11 chunks analyzed, 50 slices sequenced across 5 phases. Ready for execution starting S2.

**Cold-start execution session read order:**
1. This §1a + §2 (guardrails)
2. **§1b Independent review overrides (2026-09-16) — wins on any conflict with §11b**
3. §11b Master slice sequence (the catalogue; rows marked ⚠ SUPERSEDED are replaced by §1b-C)
4. §11d Prerequisites checklist + §1b-A (gating Qs already answered by code)
5. §11e Open Qs — remaining gating ones with Dan BEFORE starting Phase 1 (Q10.1/Q10.2 are answered — see §1b-A)
6. Then start with **Phase 0: X0 (types → src/types.ts), X1 (test scaffolding), X2 (state-consumer baseline)**, then W1

**Rules that inherit into every execution session:**
- No code changes until Dan explicitly approves a specific slice
- Every slice: feature branch → Vercel preview → Dan eyeball → ff-merge → cleanup
- `npm run build` (not just `tsc --noEmit`) before every push
- Convera/QB Auto slices require tests before merge
- Update §5 status + §8 session log at session end
- Save memory when a decision made that's non-obvious/durable

### 1b. INDEPENDENT REVIEW OVERRIDES — 2026-09-16 (READ BEFORE §11b; THIS SECTION WINS ON CONFLICT)

**Who/what:** second-model review of this plan against `src/TimesheetSystem.tsx` @ `ce527f1` (15,871 lines), `src/roles/Manager/ManagerView.tsx`, `src/roles/VendorManager/VendorManagerView.tsx`, git history, `package.json`, existing tests. Every claim below was verified by grep/read, not inferred. Line numbers are as of `ce527f1` — **always re-grep before editing; never trust a line number in this doc.**

**How to use:** §11b remains the slice catalogue, but rows marked `⚠ SUPERSEDED — see §1b` there are replaced by the specs here. The amended execution order is §1b-C. The executor rules in §1b-E are mandatory for every slice.

---

#### 1b-A. Gating questions already answered by the code (no need to ask Dan)

| Q | Answer | Evidence |
|---|---|---|
| Q10.1 Vitest vs Jest | **Vitest.** Already installed (`vitest ^4`), `npm test` = `vitest run`, 14 existing `*.test.ts` files under `src/lib/**`. §11a "Tests added: 2" is wrong — it is 14. | `package.json`; `find src -name '*.test.*'` |
| Q10.2 / T79 `applyConveraPayments` alive? | **Does not exist.** Zero hits in `src/`. Delete from V8 and V11 file lists. | `grep -rn applyConveraPayments src` → nothing |
| Q2.2 / T11 `sourceCounts` used? | **Yes — keep it.** `ConsolidatedTable` (TS 59–120) renders a 5th "Submission Channels" KPI card from `report.sourceCounts`. C3's shared fn must keep `includeSourceCounts`. | TS 68, 95–119 |
| Q8.4 localStorage migration for `qbInboxExpanded` | **Moot.** Nothing in TS.tsx persists it; the only `localStorage` use is `profile_reminder_*` (1674–1682). | `grep -n localStorage` |
| Q7.2 fee tolerance | Constant confirmed: `deltaAbs <= 50` at 9511. Still needs Dan's intent, but the test (INV10) can be written now against the constant. | TS 9511 |

#### 1b-B. Factual corrections to the plan (each changes a slice)

| # | Plan says | Code says | Affects |
|---|---|---|---|
| F1 | StickyScrollWrapper has 4 sites: Auth 129, Weekly 7426, Invoices 8484, TS-Only 8849 | **3 sites.** 129 is inside `ConsolidatedTable` (not Auth); 8849 is the *closing* tag of the Invoices site; Timesheet-Only uses its own `overflow-auto` div (9021). | W1 (3 import sites); **C2 now depends on W1** because ConsolidatedTable uses it |
| F2 | T32: `qbVendorEditingId`/`qbVendorEditValue` shared by PP tab + **QB Automation tab** (12493) | Second consumer is the **QbExport modal** (12469–12504, inside 12320–12586). The QB Automation tab (9843–11560) never touches them. Also `saveQbVendorName` (3910–3919) itself calls `setQbVendorEditingId(null)`/`setQbVendorEditValue('')`. | Remove from QA7/QA9 prop lists; add to **QE** deps; if state is split per caller (Q5.3), `saveQbVendorName` must stop resetting it — the caller resets |
| F3 | §8a Catalog (`qbVendorsList` etc.) "referenced from Payment Profiles for `qbVendorSuggestions`" | PP tab's `qbVendorSuggestions` (11589) derives from `paymentProfiles`, not `qbVendorsList`. But `qbVendorsList` **IS cross-consumed**: `VendorDecisionModal` at the accountant wrapper (7246) reads it, and `loadQbVendorsAndAccounts()` is called from `handlePaymentsImport` (5293) and the rollback path (5663). | `qbVendorsList`, `qbAccountsList`, `qbVendorMappings` + their loaders stay at **wrapper** level (or a wrapper-level `useQbCatalog()`), NOT inside QA7 |
| F4 | I7: InvoiceDetail is one dual-owner modal, ~3 hrs with `mode` prop | **Two different things.** Accountant InvoiceDetail = 13392–14209 (**~818 lines**, largest modal in the file; owns 18 `pending*` hooks at 1235–1252 + reset effect at 1583; calls `handleInvoiceAction`, `saveInvoiceEdits`, `savePeriodEdit`, `saveValueEdit`, `applyUsdRate`, `previewPeriodChange`, `handleAttachmentUploadForExisting`, `deletePaymentProfile`, `loadConveraBeneficiaries`, `openAttachment`, `reconcileInvoiceLive`, `calculatePayOn`). TimesheetUser "InvoiceDetail" = 15535–15649, ~115 lines, read-only, uses none of the `pending*` state. | I7 re-specified in §1b-C (accountant-only, 6–8 hrs, risk tier = Chunk 7). TSU card stays in place for the TSU arc. |
| F5 | PP2 AutocompletePicker: "4+ sites" | **2 `<datalist>` sites** (PP tab 11639, QbExport 12449). Mapping widget (10249) is a filtered search-list over `qbVendorsList`; Convera Matching is a different picker. | PP2 re-scoped to `QbVendorNameEditor` (2 sites). Do not design a generic picker before QA4 reveals the mapping widget's needs. |
| F6 | T3: 4 variants of one day-column table incl. Weekly; "Manager row is bulk-select-toggle target" | Weekly (7427–7464) renders per-**user** `reportData` rows with date-labelled headers, sticky ID/Employee cols and a TOTAL footer — a different data shape from the 3 per-**timesheet** tables. Manager row click opens the modal; only the checkbox toggles selection. Both drift copies (Manager, VM) are in **dormant** roles. | T3 descoped in §1b-C |
| F7 | T26 / CEP1: estimation queries fire on every accountant login | **Already lazy.** The effect at 1520 returns unless `accountantTab === 'client-estimation'`. | Drop "lazy-load" from CEP1; CEP1 = dead-code removal only (T23 `engagementsByClient` 7655, T24 `orphanEngagements` 7666 — both confirmed write-only) |
| F8 | Accountant block 7,165 → ~15,429 | 7165 → **14660**; TimesheetUser view starts at 14662. | Scope numbers only |
| F9 | §11a target TS.tsx 3,500–4,500 (−73%) | Not reachable with the listed slices. 15,871 − accountant block (~7,495) − Convera (~2,000) − relocated hooks (~300) + wrapper (~200) ≈ **6,000–6,500**. Reaching 3.5–4.5k additionally requires extracting ~960 lines of QB pre-role functions (2410–3371), ~970 lines of invoice handlers (3585–4557) and ~420 lines of batch/IIF builders (5684–6108) — the very "pre-role shared handlers" §2 defers. | Headline reset in §1b-F; new Phase 4b/6 slices in §1b-C |
| F10 | PP3: PaymentProfileModal has 3 consumers (Accountant + VM + TSU) | The only `{showProfileModal && …}` render in TS.tsx is at 15778, **inside the TimesheetUser branch**. The accountant branch returns at 14659. Accountant PP tab's "Edit" (11736) and "+ New profile" (11751) set the flag into a void. True since `cb9501c` (2026-06-17). | See §1b-G bug #1 — **Dan must confirm by clicking before PP3 is scoped** |
| F11 | PP3 depends on A11; A11 "deferred to Admin extract" | Contradiction. | A11 pulled into Phase 3 immediately before PP3, or PP3 keeps the inline country select. Executor: keep inline, log it. |
| F12 | QbExport modal "~450 lines" | 12320–12586 = ~267 lines. ConveraMatching 12799–13136 (~338), ConveraBatch 11839–12197 (~359), PaymentImport 13137–13391 (~255), PaymentIif 12587–12734 (~148), IntuitBatch 12198–12319 (~122), TemplateProfile 11772–11838 (~67), ClientInvoice 14225–14657 (~433). | Effort sanity only |
| F13 | I6 props | Invoices tab also writes `setPendingPayOnDate('')`/`setPendingPaidDate('')` before opening the modal (8620, 8624, 8822, 8826). | Replace with wrapper-owned `openInvoiceDetail(inv)` — see §1b-C X3 |
| F14 | I3 | `invoiceMonthPreset` is defaulted by an effect at 1609 when invoices load. | That effect moves into `useInvoiceFilters()` |
| F15 | T1 (Weekly `generateReport` re-runs every render) | Both `generateReport()` **and** `generateConsolidatedReport()` run at wrapper scope (7166–7231) on **every** accountant render, on every tab. | W3 + C5 are perf wins for the whole accountant view, not just their tabs |

#### 1b-C. AMENDED MASTER SEQUENCE (supersedes §11b ordering; slice IDs starting with X are new)

**PHASE 0 — Unblockers (new). Do these before anything else. ~4–5 hrs.**

| ID | Slice | Spec | Zero-regression check |
|---|---|---|---|
| **X0** | Domain types → `src/types.ts` | Move every `interface`/`type` between TS 260 and 614 (`UserProfile`, `Project`, `TimeEntry`, `Timesheet`, `PaymentProfile`, `ConveraBeneficiary`, `InvoiceLine`, `Invoice`, `InvoiceEditEntry`, `ImportBatch*`, `MatchState`, `MatchConfidence`, `ConveraTransaction`, `ReminderEmail`, `UserForm`, `ProjectForm`, `QbIngest*`, `QbVendor`, `QbAccount`, `QbPayeeListKind`, `QbVendorMapping`, `QbResolvedAction`, `QbIngestEvent`, `ReconTimesheetRow`) plus `WORLD_COUNTRIES` (495) to `src/types.ts` (constants to `src/lib/countries.ts`). **Export all of them** — `ConveraBeneficiary`, `ConveraTransaction`, `ImportBatch`, `QbIngestEvent` are currently unexported and V3/V8/QA1/QA2 cannot compile without them. TS.tsx re-imports; keep `export type { … } from './types'` re-exports in TS.tsx so ManagerView/VM/TimesheetDetailModal keep working, then repoint those three imports to `../../types` in the same slice. | `npm run build` clean; `npx tsc -b` clean; no runtime change |
| **X1** | Component-test scaffolding | Add `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` devDeps; add `test: { environment: 'jsdom', setupFiles: […] }` to `vite.config.ts`; keep existing node-env lib tests passing (use `// @vitest-environment node` or per-file env). One smoke test rendering `<MonthRangePicker>`. Needed by C3/T3/PP3/I7/QA8 in Phases 2–4, not Phase 5. | `npm test` green incl. existing 14 files |
| **X2** | Run `python3 .claude/scripts/state-consumer-map.py` and commit its output as `.claude/plans/state-consumer-map-baseline.txt` | Baseline for the §1b-E rule. Re-run per slice. | — |

**PHASE 1 — Foundation atoms (as §11b, with amendments). ~9–10 hrs.**

- W1: **3** sites (ConsolidatedTable 129, Weekly 7426, Invoices 8484). Unchanged otherwise.
- T1, T2, A10, PP1 (base), B4, B6, I4, FileUploadCard: unchanged.
- **PP2 → `QbVendorNameEditor`** (2 sites: PP tab 11696–11722, QbExport 12469–12504). Props `{ value, suggestions, onSave, onCancel }`. Component owns its own edit-value state. Do NOT touch `saveQbVendorName`'s reset lines until both callers are migrated, then delete them (F2).
- **X3 `openInvoiceDetail(inv)` wrapper helper** (30 min): one function in pre-role that does `setSelectedInvoice(inv); setPendingPayOnDate(''); setPendingPaidDate(''); setShowInvoiceModal(true)`. Replace the 4 Invoices-tab sites (8620/8624/8822/8826). PP Last-Used (11726) and TSU open (15406) only call `setSelectedInvoice + setShowInvoiceModal(true)` (no pending resets) — leave those two as-is; the reset effect at 1583 already clears `pending*` on `selectedInvoice.id` change, so the explicit resets in the Invoices tab are belt-and-braces. Lines 15541/15548/15617/15627 are `setShowInvoiceModal(false)` closes — untouched. `openInvoiceDetail` becomes the single cross-tab prop for I6; PP4 keeps the 2-call form.

**PHASE 2 — Easy tab extracts (as §11b, amendments):**

- C1 ✅. **C2 depends on W1** (F1). C3/C4/C5 unchanged; C3's shared fn signature must include `includeSourceCounts` (1b-A).
- W3: also delete the wrapper-scope `reportData/weekDates/grandTotal` (7166–7168) — they are Weekly-only (verified: Consolidated uses its own `gt`, TS-Only declares its own `weekDates`).
- **T3 DESCOPED →** `src/components/DayHourCells.tsx`: renders the 7 `<td>` day cells + Total cell from `(entries, weekStart)`; optional `weekdayHeaders(weekStart)` helper for the `<th>` row. Consumers: TS-Only (9059–9061), Manager (ManagerView ~238–248), VM (VendorManagerView 285–288). **Weekly is NOT a consumer.** No snapshot suite — one unit test on the cell computation. ~2 hrs. VM migration also fixes §1b-G bug #2 (VM header has Mon–Fri only) — when migrating VM, render 7 headers to match the 7 cells, and log it as a behavior change.
- T4: unchanged. CEP1 = dead-code only (F7). CEP2 unchanged.

**PHASE 3 — Cross-role modals (amended):**

- **PP3 — FINAL SPEC (bug #1 confirmed 2026-09-16).** Bug fix + extraction, ~4 hrs + tests, prereqs X1 + PP2(QbVendorNameEditor); A11 NOT required (keep the inline country select).
  1. Extract the JSX at 15777–15863 (TSU branch, `{showProfileModal && (…)}`) to `src/components/PaymentProfileModal.tsx`. Props: `{ open, mode: 'full' | 'basic', form, setForm, editingProfile, onSave: savePaymentProfile, onCancel }` where `onCancel` = `setShowProfileModal(false); setProfileEditUserId(null)` (match the existing overlay onClick at 15779). `mode='basic'` hides the fields VM's inline copy omits (diff VendorManagerView's inline modal vs 15777–15863 to derive the list — record it in the component file).
  2. Mount `<PaymentProfileModal mode="full" …/>` in the **accountant wrapper** (next to `VendorDecisionModal` at ~7235) — this is the bug fix. Mount the same in the TSU branch replacing 15777–15863. Replace VM's inline copy with `mode="basic"` and delete the corresponding drilled props from `VendorManagerViewProps`.
  3. `savePaymentProfile` (4558) reads `profileForm`/`editingProfile`/`profileEditUserId` from closure and stays pre-role (T99). Verify it handles the accountant path (`profileEditUserId` set to the target user at 11734/11749) — it was written for that but has never executed from the accountant branch; test it.
  4. Tests (X1): render in both modes; accountant Edit → form pre-filled from profile; accountant New → `emptyProfileForm()`; Save calls `onSave`; Cancel clears `profileEditUserId`.
  5. Zero-regression: accountant Edit/New/Save/Delete round-trip all fields (first time ever — expect to find follow-on bugs in `savePaymentProfile`'s accountant path; log, don't scope-creep); TSU profile flow unchanged; VM basic mode unchanged.
- **I7 RE-SPECIFIED:** `src/roles/Accountant/modals/InvoiceDetailModal.tsx`, accountant-only. Moves with it: the 18 `pending*`/`*EditOpen`/`*PreviewShown` hooks (1235–1252), the reset effect (1583–1596), and the modal JSX 13392–14209. Receives as props the 12 handlers listed in F4 + `openAttachment`. `selectedInvoice`/`showInvoiceModal` stay at TS.tsx (shared with TSU). **Tests before extract** (X1 scaffolding): render approved/submitted/paid fixtures; assert action buttons present per status; assert period-edit preview gate. 6–8 hrs. Risk tier: same as PL6. Do this **after** I6, not before.
- M0 unchanged. A11/A9 per F11.

**PHASE 4 — Big tabs (amended ordering; see rule E2):**

- PP4, I1, I2, I3, I5, I6, CB, IB, QE, CM, PI as §11b, with: I6 uses X3 instead of `setSelectedInvoice/setShowInvoiceModal/setPending*`; **QE deps += `QbVendorNameEditor`, `saveQbVendorName`, `buildIifContent` (3945–4072), `saveInvoiceExportStatus` (3921), `bulkMarkInvoiceExportStatus` (3933)`** (F2).
- **CB is GATED on X6 (below).** ConveraBatch modal drags `downloadConveraBatchCSV` (6027–6101) and the `converaBatch*` state with it; that CSV is the file uploaded to Convera to move money. No tests → no extract.
- **Payments (PL1–PL6) MOVE TO AFTER V8** (Phase 5C). Reason: `handlePaymentsImport`, `handleProcess`, `handleReopenBatch`, `handleRollbackBatch` read `stagedMatches`, `paymentsImportFile`, `selectedBatchId`, `paymentsStateFilter` from closure and write `setStagedMatches`, `setShowProcessPreview`, `setProcessCommitting`, `setSelectedBatchId`, `setPaymentsStateFilter`, `setPaymentsImportSummary`, `setPaymentsProcessResult`, `setPaymentsImportFile`, `setPaymentsImportError`, `setPaymentsFileInputKey` (verified per handler). PL1 cannot own that state while the handlers are pre-role. T85 is reversed: **V1–V8 first, then PL1–PL6.** V8's orchestrator signature must be `async fn({ supabase, ...inputs }) => Result` with **no setState calls inside**; the Payments tab applies the result to its own state. Alerts move to the caller too (return `{ ok:false, step, message }`).
- **🛑 STOP GATE — QB Automation discussion with Dan required before X4/QA7/QA8/QA9.** Set 2026-09-17 (S4). Dan wants to talk through the QB Automation tab BEFORE any of its slices (X4, QA7, QA8, QA9) start. The talk may reshape the whole tab and could change what X4's API boundary should look like. When execution reaches X4 (immediately after IB in Phase 4 ordering), pause and prompt Dan for the conversation. Do NOT begin scoping X4 without that discussion.
- **QB Automation: add X4 before QA7.**
  - **X4 `src/api/qbAutomation/`** (new, ~6–8 hrs, tests for the pure parts): move `loadQbIngestEvents` (2410), `recomputeMatchesForPending` (2442), `applyClassificationPass` (2493), `applyReconciliationPass` (2594, 276 lines), `runRecomputeButton`, `loadQbVendorMappings`, `loadQbVendorsAndAccounts`, `loadQbOpenBills`, `loadQbWcLastSeen`, `loadQbBillQueryPending`, `refreshQbVendors`, `loadQbVendorQueryPending`, `runSyncQbVendors`, `runSyncQbBills`, `loadInflightPushRecords` (2410–3239), `markAlreadyDone*` (3240–3286), `openMapWidget`/`saveVendorMapping` (3287–3371). Same rule as V8: functions take `{ supabase, ...inputs }` and return data; **no setState inside**. The tab-open effect (3191–3222) and the 30 s poll (3228–3236) move into the tab component in QA9 and call these.
  - QA7 then owns only true tab-local hooks. **Excluded from QA7 (stay at wrapper):** `qbVendorsList`, `qbAccountsList`, `qbVendorMappings` (F3), `vendorDecisionState` (7235), `qbExport*` (Invoices/QE), `qbVendorEditing*` (F2 — PP/QE).
  - QA7 effort → 6–8 hrs. QA8/QA9 unchanged.
- **X5 Convera Batch file tests** (before CB): lock `openConveraBatchPreview` (5777–6001) grouping + `downloadConveraBatchCSV` (6027–6101) output: combined-group Ref1 rule (TEAL umbrella), India `PURPOSE OF FUNDS P0802` Ref2, 100-char beneName cap, `csvEscape`. Extract the pure parts to `src/lib/convera/batchFile.ts`. ~3 hrs. **X6 = X5 + extract.**
- **X7 IIF builders**: `buildIifContent` (3945–4072), `buildPaymentIifContent` (4144–4231), `buildPaymentIifPreview` (4073–4143) → `src/lib/qb/iif.ts` with fixture tests (3-account Key Point→WU→A/P split). Replaces V9. ~3 hrs. Prereq for QE and PI.

**PHASE 5 — Convera pipeline (as §11b, amendments):**

- V1: reuse `makeMockSupabase` from `src/lib/qbWrite/consumers/__tests__/converaCreateBillAndPay.test.ts` — V1 shrinks to ~2 hrs.
- V5 must add the case: **step failure → no refetch, `stagedMatches` retained, local `converaTransactions`/`invoices` stale vs DB** (every `if (error) { alert; return; }` in 5401–5480 returns before the refetches at 5507–5509). Lock it as current behavior; do not "fix" it in this arc (log as follow-up with T76).
- V8: orchestrators are pure of setState (see Payments note). Delete `applyConveraPayments` from the file list (1b-A).
- V9 replaced by X7. V10/V11 after PL6 (which is now after V8).

**PHASE 6 — DECISION (Dan, 2026-09-16: "if it makes sense we do it; seed on risk/cost vs benefit"):**

| Option | Cost | Risk | Benefit | Verdict |
|---|---|---|---|---|
| **6-lite** — tests only for `handleInvoiceAction` + `tryResolveVendorForApproval` + `lockTimesheetDaysForInvoice` (no code moves) | ~6 hrs | Nil (no code change) | Locks the approve→pay money path before I6/I7/QE/CM touch it; reusable verbatim if full Phase 6 runs later | **DO NOW — insert as X8 before I6** |
| **Full Phase 6** in this arc | 20–25 hrs | High-stakes handlers; arc already 130–150 hrs with expected 20–30% slip | TS.tsx ~6,000 → ~4,000; but the same move is a hard prerequisite of the TSU-role arc anyway | **DEFER to the TSU arc**, where it is required rather than optional. Go/no-go checkpoint after V11: if the arc landed within ~20% of estimate and Dan still wants the file smaller, run it then. |

Arc success criterion is therefore **TS.tsx ≈ 6,000–6,500 lines** (§1b-F), not 3,500–4,500. §11f checkbox 1 is amended accordingly.

**X8 — Invoice approval-path tests (6-lite, ~6 hrs, before I6):** mock Supabase via the existing `makeMockSupabase` pattern; cases: approve with terms cascade (3878–3882), approve locks timesheet days (3884–3886), approve with ambiguous vendor → `tryResolveVendorForApproval` returns 'blocked' and sets `vendorDecisionState` (3775–3832), reject, mark paid with `paidDate`/`pmOverride`, and the post-action resets (3888–3894). These tests run against the inline functions (import nothing from TS.tsx — copy the functions into a test harness only if unavoidable; prefer waiting for X0 so types import cleanly).

**Full Phase 6 spec (retained for the TSU arc):** invoice actions `handleInvoiceAction`, `tryResolveVendorForApproval`, `saveInvoiceEdits`, `savePeriodEdit`, `saveValueEdit`, `switchInvoicePaymentProfile`, `applyUsdRate`, `previewPeriodChange`, `lockTimesheetDaysForInvoice` (3585–4557) → `src/api/invoices/`; `openConveraBatchPreview`, `openIntuitBatchPreview`, `exportInvoicesCSV`, `commitIntuitXlsxToInbox` (5633–6108) → `src/api/batches/`. Tests-first for `handleInvoiceAction` + `tryResolveVendorForApproval` (approval is the daily money path). ~20–25 hrs. Optional for the arc; mandatory for the −73% headline.

#### 1b-D. Additional traps (T86–T99)

| # | Trap | Rule |
|---|---|---|
| T86 | Pre-role handlers write "tab-local" state (Payments: 10 setters across 4 Convera handlers; QB: ~15 loaders/passes; Invoices: `saveInvoiceExportStatus`/`bulkMark…` write `qbExportSnapshot`; `handleInvoiceAction` closes the invoice modal and resets 6 `pending*`; `saveQbVendorName` resets edit state). | **E1** below. |
| T87 | The QB tab-open effect (3191) performs DB writes on mount (`recomputeMatchesForPending` → `applyClassificationPass` → `applyReconciliationPass`). Moving it into the tab component preserves semantics (tab JSX is conditional today), but re-mounts caused by React key changes or parent re-structure will re-fire writes. | QA9: keep the effect keyed on `[currentUser?.role, invoices.length]` only; never add a dep that changes on every render; add a `ranRef` guard for StrictMode double-mount in dev. |
| T88 | `qbVendorsList` is empty until QB tab open / Convera import; `VendorDecisionModal` (7246) then has no vendors. | Not a refactor trap — §1b-G bug #3. Don't "fix" inside an extract slice. |
| T89 | ManagerView imports the **value** `ConsolidatedTable` from TS.tsx while TS.tsx imports ManagerView → real runtime circular import. Works today by luck of evaluation order. | C2 removes it. Until C2 lands, never add another value import from TS.tsx into a role file. |
| T90 | Zero `useMemo`/`useCallback` in TS.tsx. Adding memoization during extracts is a behavior change if deps are wrong. | Memoize only with exhaustive deps and only when the slice's zero-regression check exercises the dep change (e.g. change week → table updates). |
| T91 | `openConveraBatchPreview` (5793–5798) **replaces global** `paymentProfiles` and `converaBeneficiaries` state with fresh DB reads as a side effect. | When extracted (X6/Phase 6), the returned fresh arrays must still be applied to global state by the caller — do not drop this. |
| T92 | `handleProcess` `if (paymentsStateFilter === 'unreviewed') setPaymentsStateFilter('all')` (5507) — UX rule that lives in the orchestrator. | V8 returns `resetFilter: true`; PL6 applies it. Lock in V5. |
| T93 | Effects tied to `accountantTab` live pre-role: 1520 (estimation load), 1609 (invoice month preset default), 2401 (payments load), 3191/3228 (QB load + poll). | Each moves into its tab in that tab's extract slice; the executor must grep `accountantTab` in pre-role after every tab extract and confirm the count dropped. |
| T94 | Weekly's KPI grid (7352) computes `testAccounts` from `users` at render; `generateReport` also filters test accounts. Two definitions of "test". | W3: compute once inside `Weekly.tsx`, pass to both. |
| T95 | `downloadConsolidatedCSV` and `downloadMgrCSV` both apply `countryName()` to `row.country`, which was already `countryName(user.country)` in the report. Harmless (fallback returns input) but must be preserved byte-for-byte in C4's diff check — do not "clean" it in C4; log as follow-up. | C4 byte-diff will pass only if kept. |
| T96 | `VendorDecisionModal` and `TimesheetDetailModal` are rendered at accountant-wrapper scope (7235, ~14215). | They stay in the wrapper after all tab extracts. |
| T97 | Accountant wrapper computes tab badges from `invoices` and `converaTransactions`/`importBatches` (7308–7330) — these arrays must remain wrapper-level; Payments tab must not "own" `converaTransactions`. | PL6 receives them as props (already in §11b list). |
| T98 | TSU "InvoiceDetail" (15535) shares `selectedInvoice`/`showInvoiceModal` with the accountant modal; `userTab === 'invoices'` guard. | I7 leaves both hooks in TS.tsx. |
| T99 | PP3/PP4: `savePaymentProfile` (4558) and `emptyProfileForm` (1451) are pre-role and used by VM props (7142–7148) + TSU. | They stay pre-role until the TSU arc; passed as props. |

#### 1b-E. EXECUTOR RULES (mandatory, mechanical — apply to every slice)

- **E1 — State-relocation gate.** Before moving ANY `useState` out of pre-role: run `python3 .claude/scripts/state-consumer-map.py <name>`. The hook may move into a tab only if every region except that tab reports 0. If `prerole` is non-zero, list the functions (grep `set<Name>(` in 795–6355); the slice must move those functions in the same commit (pure `api/` signature, no setState) **or** keep the hook at the wrapper. "Move now, fix consumer later" is forbidden.
- **E2 — Handler-before-tab.** A tab extract (W3, C5, T4, CEP2, PP4, I6, PL6, QA9) may only start after every pre-role function it calls has been either (a) extracted to `src/api/*` / `src/lib/*` with no setState inside, or (b) explicitly listed in the slice as a prop. No third option.
- **E3 — Grep-before-edit.** Every line number in this doc is stale the moment a slice lands. Re-locate by symbol name every time.
- **E4 — Tab-effect check.** After each tab extract: `grep -n accountantTab src/TimesheetSystem.tsx` — the count must go down by that tab's effects (T93) or the slice is incomplete.
- **E5 — Types come from `src/types.ts`** (after X0). Never `import … from '../../TimesheetSystem'` in a new file.
- **E6 — Tests-first list** (extended): C3, T3(DayHourCells), PP3, I7, QA1, QA2, QA8, X5/X6, X7, V2, V5–V7, Phase 6 invoice actions.
- **E7 — Byte-diff CSV/IIF/batch outputs** before and after any slice that touches a download builder (C4, W3 CSV, T4 CSV, X6, X7, QE).
- **E8 — Stop conditions.** Stop and ask Dan if: a state hook fails E1 and the plan says it is tab-local; a pre-role function not in the slice spec must change; a zero-regression check needs data the preview env doesn't have.
- **E9 — Merge timing per risk tier.** Match the merge window to the slice's risk tier per §2 "Merge timing & rollback discipline". Never merge a High-tier slice during accountant working hours. Claude runs the zero-regression check on the preview URL and reports before pinging Dan.

#### 1b-F. Corrected headline

| Metric | Plan | Corrected |
|---|---|---|
| TS.tsx after Phases 0–5 | 3,500–4,500 | **~6,000–6,500** |
| TS.tsx after Phase 6 too | — | **~3,800–4,300** |
| Existing tests | 2 | 14 files |
| Added effort (X0–X7, I7 resize, QA7 resize, Phase 6) | — | +15 hrs (X-slices) / +20–25 hrs (Phase 6) |
| Removed effort (T3 descope, PP2 descope, V1/V9 replaced) | — | −8 hrs |

#### 1b-G. Shipping bugs found during review — Dan to triage (NOT slices until confirmed)

1. **✅ CONFIRMED by Dan 2026-09-16 — no modal opens.** Accountant Payment Profiles "Edit" / "+ New profile" are inert: `setShowProfileModal(true)` at 11736/11751; only render is 15777–15863 (TSU branch); accountant branch returns at 14659. Broken since `cb9501c` (2026-06-17). **Resolution: PP3 is now a bug fix + extraction and moves to the front of Phase 3 (right after Phase 1 lands, before Phase 2 tab extracts is also acceptable).** Spec below in §1b-C.
2. **VendorManager Team Timesheets table misaligned** — header Mon–Fri (5 cols, `colSpan={10}`), body renders 7 `dailyHours` cells (VendorManagerView 268–291). Dormant role. Fix in T3-descoped VM migration.
3. **`VendorDecisionModal` opens with an empty vendor list** if the accountant approves an Intuit/Convera invoice before ever opening QB Automation in that session (`qbVendorsList` only loads at 3196/5293/5663). Fix: call `loadQbVendorsAndAccounts()` inside `tryResolveVendorForApproval` when the list is empty. One-line hotfix candidate; do it outside the arc.
4. **Payments tab badge shows 0 until the tab has been opened once** — `fetchConveraTransactions`/`fetchImportBatches` run only in the tab-open effect (2401). Fix: also call them in the accountant login load (1637 block). Hotfix candidate.
5. (Latent, not user-visible) `handleProcess` mid-step failure leaves local state stale — see V5 amendment; T76 follow-up.

---


## 2. Non-negotiable guardrails (system operates flawlessly across sessions)

**Deployment discipline** (proven pattern from Slices 1–5)
- Every slice = feature branch → Vercel preview → Dan eyeball → ff-merge to main → branch cleanup.
- Main always deployable. No slice half-lands.
- `npm run build` (not just `tsc --noEmit`) before every push. [[feedback_npm_build_before_push]]

**Merge timing & rollback discipline** (added 2026-09-16 after X0 discussion)

Vercel auto-deploys main → prod within minutes. Every ff-merge is a live release. Merge timing must match slice risk tier, not arc calendar pressure.

*Risk tiers → merge windows:*
- **Trivial (types-only, dead-code cleanup, single-const relocation):** merge same-hour, any time. Examples: X0, C1 (empty-state copy).
- **Low (foundation atoms, cross-file component extracts, no state moves):** merge same-day; sit on preview ~30 min. Examples: W1, T1, T2.
- **Medium (tab extract with tab-local state moves, no pre-role handler changes):** merge outside accountant working hours (US East 9am–5pm ET → merge evenings/weekends). Sit on preview >2 hrs. Examples: W3, C5, T4, CEP2, PP4, I6.
- **High (pre-role handler extract, cross-role modal, Convera/QB Automation touches):** merge evenings/weekends only. Sit on preview >24 hrs. Claude walks the zero-regression check on the preview URL and reports before pinging Dan. Examples: X4, X6, X7, I7, QE, PL6, QA9, V-series.

*Rollback is a first-class ops step, not a failure:*
- `git revert <slice-hash> && git push` → prod restored to last-good in ~30 sec.
- Two savepoints always: `main~1` (immediate) and `main~2` (belt-and-braces).
- If a regression is found within the preview window (before merge), we amend or force-push the feature branch; only merged-to-main slices need `git revert`.

*Zero-regression check protocol per slice:*
1. Slice spec names the check up-front (already required in §11b).
2. Claude runs the check on the preview URL and pastes the result into the chat before asking Dan to eyeball.
3. Dan's eyeball is a **second** layer, not the only layer.

*Cadence rule:* No arc merges on days Dan is heads-down on Convera/accountant testing/production incidents. Slower is fine; the mechanism holds either way.

**Behavior-locking (per slice)**
- Every slice names the exact zero-regression check up-front (usually: manual smoke of 1–2 real flows).
- If a slice touches Convera, tests come BEFORE the extraction. Dan 2026-09-01 caveat #4.
- If a slice touches the QB Automation tab, re-read [[project_qb_automation_ux_contract]] BEFORE writing code.
- If a slice touches the payment-method chip, all 3 render paths change together. [[project_payment_method_chip_render_paths]]

**Blast radius**
- Smallest possible slice. If analysis reveals a slice touches >2 handlers or >1 tab, split further.
- One dormant risk category left untouched: pre-role shared handlers. These get extracted only after every accountant consumer has moved to `src/roles/Accountant/`.

**Reusability lens (added S1 by Dan)**
- Single-caller ≠ role-local. For every candidate: check whether variations exist in other roles (Manager/VM/TimesheetUser) or in adjacent flows. Minor-tweak reuse counts.
- Cross-role dupes go to `src/components/` or `src/features/` even if only one caller uses them today — write for the second caller.

**Self-sufficient tab principle (added S1 by Dan)**
Target state: each `src/roles/Accountant/tabs/X.tsx` OWNS everything that only it uses. Props coming in are ONLY:
- Shared data arrays (`users`, `timesheets`, `invoices`, `paymentProfiles`, `projects`)
- Cross-tab/role handlers (real cross-consumers only — verify before drilling)
- Cross-tab modal state (accountant-wrapper-owned when multiple tabs open the same modal)

Anything else that is tab-local today but lives in the pre-role section (state, memos, small helpers) MUST move into the tab file during extraction. Not moving it defeats the modularization. If a state hook has only one caller and it's the tab, it belongs INSIDE the tab.

Diagnostic to apply per slice: for each hook / handler / helper the tab uses, ask "is anything OTHER than this tab a real consumer today?" If no → tab-local. If yes → prop or shared api.

**Session handoff**
- Doc + memory MUST have enough context for a cold-start session to pick up without re-deriving.
- Every merged slice gets a MEMORY.md entry if it changed non-obvious behavior.

---

## 3. Scope

- Accountant block: **TS.tsx lines 7,165 → ~15,429** (~7,392 lines, ~46% of the file)
- 8 tabs, 7 inline modals, unknown-but-significant fraction of the pre-role shared handlers (Convera pipeline especially)
- Target directory: `src/roles/Accountant/` per audit §Target Structure
- Related extraction plans already frozen: Slice M0 (Payment Import components — see `modularization-audit.md`).

---

## 4. Confirmed map (verified 2026-09-15)

### 4a. Tab structure — `accountantTab` state at TS.tsx:1048

| # | Key | Header line | JSX starts | Est. lines | Order in this plan |
|---|---|---|---|---|---|
| 1 | `weekly` | 7292 | 7341 | ~130 | Chunk 1 |
| 2 | `consolidated` | 7296 | 7474 | ~110 | Chunk 2 |
| 3 | `timesheet-only` | 7300 | 8857 | ~230 | Chunk 3 |
| 4 | `client-estimation` | 7304 | 7586 | ~530 | Chunk 4 |
| 5 | `profiles` | 7334 | 11561 | ~210 | Chunk 5 |
| 6 | `invoices` | 7308 | 8118 | ~740 | Chunk 6 |
| 7 | `payments` | 7319 | 9088 | ~755 | Chunk 7 |
| 8 | `qb-automation` | 7330 | 9843 | ~1,720 | Chunk 8 |

Note: internally called `profiles`, presented as "Payment Profiles" in UI.

### 4b. Modal inventory (accountant-owned)

| Modal | State hook | JSX starts | Consumers | Already extracted? |
|---|---|---|---|---|
| TemplateProfile | 1461 | 11772 | Payments | No |
| ConveraBatch | 1161 | 11839 | Payments, QB Auto | No |
| IntuitBatch | 1179 | 12198 | Payments, QB Auto | No |
| QbExport | 1120 | 12320 | Invoices | No |
| ConveraMatching | 1257 | 12799 | Payments, Profiles | No |
| PaymentImport (formerly `showConveraModal`) | 1267 | 13137 | Payments, Profiles | Slice M0 spec exists |
| InvoiceDetail | 1229 | 13392 (accountant), 15535 (TimesheetUser) | **Dual-owner** | No |
| ClientInvoice (portal-mounted) | `invoiceModal` state at 1114 | ~14225 | Client Estimation tab | No — **missed in initial pass** |
| VendorDecisionModal | — | — | QB Auto | ✅ `src/components/` |
| QbPushPreviewModal + QbPushStatusPane | — | — | QB Auto | ✅ `src/components/` |
| TimesheetDetailModal | — | — | Weekly, Timesheet-Only, Manager | ✅ `src/components/` (Slice 4) |

### 4c. Shared handler surface (pre-role section, ~792–6,456)

To be inventoried per chunk. High-level pointers from audit:
- Convera pipeline: `autoMatchBeneficiary` (3302), `resolveBeneficiary` (4674), `matchPaymentGroup` (4689), `matchPaymentToInvoice` (4730), `handlePaymentsImport` (4903), `handleProcess` (5252), `handleReopenBatch`, `handleRollbackBatch`, `applyConveraPayments` (5663)
- Invoice actions: `handleInvoiceAction`, `applyUsdRate`, `previewPeriodChange`, `saveInvoiceEdits`, `handleAttachmentUploadForExisting`, `handleQbExport`, various status setters (2600–4700 range)
- Consolidated report: `generateConsolidatedReport()` (~8043–8103)

---

## 5. Sequenced slice list (running status)

| # | Slice | Status | Session | Notes |
|---|---|---|---|---|
| 0 | Inventory pass (§4) | ✅ 2026-09-15 | S1 | Map confirmed against code |
| 1 | Weekly deep-dive | ✅ 2026-09-15 | S1 | Chunk 1 — 3 slices identified, ~2–2.5 hrs total |
| 2 | Consolidated deep-dive | ✅ 2026-09-15 | S1 | Chunk 2 — 5 slices, ~3.5 hrs. Major reuse win: Manager copy-pasted the same logic in Slice 3. Also flags UX bug T7 (stale "click Apply" copy). |
| 3 | Timesheet-Only deep-dive | ✅ 2026-09-15 | S1 | Chunk 3 — 4 slices, ~8 hrs. Corrective slice T3 (A4 day-column table) fixes Slice 3 + Slice 5 copy-paste debt (4 drift copies now). |
| 4 | Client Estimation deep-dive | ✅ 2026-09-15 | S1 | Chunk 4 — **Path B (parked)** per Dan. 2 slices (~3 hrs). Missed ClientInvoice modal in initial pass — §4b corrected. |
| 5 | Payment Profiles deep-dive | ✅ 2026-09-15 | S1 | Chunk 5 — 4 slices, ~7-8 hrs. Foundation slices PP1 (FilterPills) + PP2 (AutocompletePicker) benefit 6+ later sites. PP3 (PaymentProfileModal cross-role) is compound. |
| 6 | Invoices tab deep-dive | ✅ 2026-09-15 | S1 | Chunk 6 — 5-6 slices, ~9-10 hrs. Depends on PP1/T1 landing first. I7 InvoiceDetail modal deferred to Chunk 9. Highest complexity of the tabs so far. |
| 7 | Payments tab deep-dive | ✅ 2026-09-15 | S1 | Chunk 7 — 5-6 slices, ~11-13 hrs. T53 flagged as highest-risk trap in arc (`handleProcess` has zero tests). PL7 handoff to Chunk 10 for handler extract with tests-first. |
| 8 | QB Automation deep-dive | ✅ 2026-09-15 | S1 | Chunk 8 — 9 slices, ~18-20 hrs. Biggest chunk. QA8 UX-contract snapshot tests are HARD prereq for QA9. 20+ QB state hooks + 11 render sections + UX contract locked at [[qb-automation-ux-contract]]. |
| 9 | Modals sweep + shared-atom plan | ✅ 2026-09-15 | S1 | Chunk 9 — global sequencing across 5 phases. Phase 1 foundation atoms (~10-12 hrs) unlock everything. Phase 4 (tab extracts) is ~48-55 hrs. Total arc estimate ~90-100 hrs excluding Chunk 10. |
| 10 | Convera handler extraction (B1) | ✅ 2026-09-15 | S1 | Chunk 10 — 11 slices, ~30-35 hrs. Tests-FIRST. Phase 5A (pure-fn) → 5B (orchestrator tests) → 5C (extract + integrate + delete pre-role). ~2000 lines removed from TS.tsx. Highest-risk chunk. |
| 12 | **Independent code review of plan vs code** | ✅ 2026-09-16 | R1 | §1b written. 15 factual corrections (F1–F15), 14 new traps (T86–T99), 8 new slices (X0–X7), Payments re-sequenced after V8, QA7 re-scoped, I7 re-specified, headline reset to ~6,000–6,500 (Phase 6 needed for −73%). 4 shipping bugs for Dan to triage (§1b-G). |
| 11 | Final synthesis — ordered slice list with go-signals | ✅ 2026-09-15 | S1 | Chunk 11 — deliverable. 50 slices across 5 phases, ~130-150 hrs, 15-20 sessions. Headline: TS.tsx 15,871 → ~3,500-4,500 (-73%). 7 gating Qs, 23 consultant-default Qs. |
| **X0** | Domain types → `src/types.ts` + `WORLD_COUNTRIES` → `src/lib/countries.ts` | ✅ 2026-09-16 (main `1e84784`) | S2 | Phase 0 unblocker shipped. TS.tsx 15,871 → 15,619 (-252 lines). 3 role-file couplings back to TS.tsx removed. Zero-regression: `tsc -b` clean, `npm run build` clean, 6 pre-existing test failures unchanged. |
| **Phase 0 complete** | X0, X1 (jsdom+RTL scaffold + afterEach cleanup), X2 (state-consumer-map baseline + script tracked) | ✅ 2026-09-16 | S2 | `43c3049` X1, `28097fd` X2. Unblocks Phase 1. |
| **Phase 1 complete** | W1, T1, T2, A10, PP1, PP2 (§1b-C amended → QbVendorNameEditor), B4, B6, I4, X3. FileUploadCard deferred (verify after 3 sites ready). | ✅ 2026-09-16 | S2 | 10 foundation atoms across `src/components/` + `src/lib/`. Line delete: 15,619 → 15,452 (−167 in Phase 1). Test count: 14 → ~401 passing. z-40 canonical dropdown layer codified in MultiSelectDropdown; RTL cleanup hook in `src/test/setup.ts`. Q9.3 supersedes PP1-ext (extend retroactively). |
| **Phase 2 partial** | C1 ✅ (hotfix `ce527f1` pre-arc). PP1-ext deferred per Q9.3. C2 ✅ (`498ce1e`) — ConsolidatedTable → `src/components/`, closed the last cross-file value import from TS.tsx. C3 ✅ (`d0b2a52`) — `buildConsolidatedReport` shared lib + tests; unifies Accountant + Manager 90% duplicate. C4 ✅ (`ca3cfe7`) — `buildConsolidatedCsv` shared lib + tests; T95 preserved. C5 ✅ (`df4efc9`) — first tab extract to `src/roles/Accountant/tabs/Consolidated.tsx`; 4 useState hooks moved inside. W3 ✅ (`7c79fba`) — Weekly tab extract with F15 useMemo perf fix. TS.tsx: 15,452 → 14,994 (−458 in Phase 2 so far). | 🟡 2026-09-16 (mid) | S2 | Remaining: T3 (SUPERSEDED to DayHourCells, tests-first), T4, CEP1, CEP2. |
| **Phase 2 COMPLETE** | T3 ✅ DayHourCells (`—`, S3). T4 ✅ Timesheet-Only tab extract (S3). CEP1 ✅ dead-code (S3). CEP2 ✅ Client Estimation tab folder (S3). | ✅ 2026-09-17 | S3 | Phase 2 tab-family cluster fully closed. |
| **Phase 3 COMPLETE** | PP3 ✅ PaymentProfileModal + accountant-branch bug fix (`adb9c86`, S3). FUC ✅ FileUploadCard (`f745cd9`, S4). M0 ✅ Payment Import split — `ImportIntuitPaymentsXlsx` + `ImportConveraBeneficiaries` + `converaError`→`intuitXlsxError` rename (`fa20a1d`, S4). A11 ✅ CountrySelect + COUNTRIES to lib (`4266c56`, S4). A9 ✅ PasswordResetForm (`d462fb8`, S4). | ✅ 2026-09-17 | S3+S4 | Phase 3 closed 2026-09-17 with M0 as substantive close. A11 deviated from plan's 4-site claim (2 sites use divergent WORLD_COUNTRIES; not migrated). |
| **X8** | Invoice approval-path tests (`8bf3521`, S4) — 20 tests, "6-lite" copy-into-harness pattern. Locks handleInvoiceAction + tryResolveVendorForApproval + lockTimesheetDaysForInvoice before I6/I7 touches them. Plan's stale text on `vendorDecisionState` noted. | ✅ 2026-09-17 | S4 | Zero TS.tsx delta. Prereq for I6. |
| **PP4** | Payment Profiles tab extract (`c4ca071`, S4). Tab + TemplateProfileModal bundled per plan §5g. Only 2 of 6 state hooks moved inside (profileTabExcludeTest, expandedProfileUsers); rest cross-consumed by QbExport / ImportConveraBeneficiaries / prerole helpers. | ✅ 2026-09-17 | S4 | ~2-3h actual vs plan's 90-min estimate — pattern: heavy handler-closure tabs collapse to hoist-JSX-drill-props. |
| **I1** | MultiSelectDropdown at Invoice contractor picker (`bedc49c`, S4). 52-line inline picker → 8-line component call. Null-sentinel semantics preserved via onChange wrapper. | ✅ 2026-09-17 | S4 | Third MultiSelectDropdown consumer. Cosmetic: header text picks up "selected" suffix. |
| **I2** | FilterPills extended (multi mode, per-option colored tones, prefix/extra/reset, shape=button, size=md) + 5 Invoice pill rows migrated (`7d66426`, S4). +9 FilterPills tests. Deviation from Q6.1 "optionRenderer" rec — used per-option tone props instead. | ✅ 2026-09-17 | S4 | All 5 rows: Month, Pay On, Status, Payment Method, Source. Colors preserved (Intuit=green, Convera=purple, Unassigned=amber). |
| **I3** | `useInvoiceFilters()` hook (`ca1ab0a`, S4) — owns 9 filter state hooks, default-latest-month effect, and 12 memoized derived values. +12 renderHook tests. | ✅ 2026-09-17 | S4 | Pipeline moved from tab IIFE to wrapper scope (memoized). |
| **I5** | SKIPPED per gate (2026-09-17 S5). InvoiceDetail modal renders a full recon section (not compact badge); row + group sites share badge shape and were dedup-ed inside I6 via `InvoiceReconBadge`. No standalone slice. | ⏩ 2026-09-17 | S5 | Gate-decision documented in commit body + memory `[[accountant-modularization-s4]]` point 10. |
| **I6** | Invoices tab extract to `src/roles/Accountant/tabs/Invoices.tsx` (`596d696`, S5). Plus `InvoiceReconBadge` (compact recon pill for row + group-header sites, +11 tests) + `reconcileInvoiceLive` moved to `src/lib/reconcileInvoice.ts`. Wrapper collapsed to `const invoiceFilters = useInvoiceFilters(...); <InvoicesTab {...invoiceFilters} .../>`. T42 stale line comment fixed. Group site `groupReconStatus` renamed `unknown`→`unverifiable` for consistency with lib return type. | ✅ 2026-09-17 | S5 | Largest single-slice delta of the arc: −692 lines. 502 passing / 6 pre-existing fails. E4: `accountantTab` count unchanged (I3 had already migrated the tab-guarded effect). |
| **X7** | **AMENDED — deletion path, not extract.** Deleted `buildIifContent` + `buildPaymentIifPreview` + `buildPaymentIifContent` + `bulkMarkInvoiceExportStatus` + `bulkMarkPaymentExportStatus` + `paymentIifPreview` hook + PaymentIif* types + Generate IIF button (QbExport footer) + stale "Chunk 2a" hint + Export Payments IIF button (Payments tab) + full Payment IIF preview modal (`bee1c43`, S6, 2026-09-18). Full source archived at `.claude/archive/deprecated-2026-09-iif-export.md`. Dan confirmed IIF export not used in qbXML era; QbExport modal itself RETAINED for its category-card status inspector (may factor into QB Automation UX discussion at STOP gate — see `[[qb-automation-stop-gate]]`). | ✅ 2026-09-18 | S6 | −496 lines TS.tsx (12,356 → 11,860). Cumulative arc −25.3%. Build clean; 502 pass / 6 pre-existing fail. Downstream V9 (already ⚠ SUPERSEDED by original X7) further supersedes QE/PI dependencies — re-scope when we reach them. |
| **I7** | Accountant InvoiceDetailModal → `src/roles/Accountant/modals/InvoiceDetailModal.tsx` (~630 lines) + `calculatePayOn` → `src/lib/invoiceDates.ts` (`3b57336`, S6, 2026-09-18). Moved: 818 lines modal JSX + 16 pending*/edit-open/preview-shown hooks + reset effect on `inv.id`. Wrapper retained: `selectedInvoice`, `showInvoiceModal` (shared with TSU per T98), `beneficiaryOverride*` (shared with PP tab), `attachmentUploading` (shared with TSU). 13 handlers threaded as props (as-is, unchanged signatures). Applied [[modal-owner-callback-pattern]] I7 addendum: pre-role handlers' trailing `setPendingX('')` lines DELETED (5 handlers cleaned); modal's own onClick wraps handler calls with local resets. Also dropped `openInvoiceDetail`'s belt-and-braces pending* resets (§1b-C X3) — now truly moot. +14 render tests. Debug map at [[invoice-detail-modal-i7]]. | ✅ 2026-09-18 | S6 | **−865 lines TS.tsx (11,860 → 10,995).** Cumulative arc −30.7%. Build clean; 516 pass (+14) / 6 pre-existing fail. High-risk merge shipped with Dan's eyeball on preview — accountant uses daily, watch for regressions. |
| **X5+X6** | Convera batch file: extract CSV builders → `src/lib/convera/batchFile.ts` + 34 behavior-lock tests (`7f20e44`, S6, 2026-09-18). Extracted: `csvEscape`, `fmtConveraAmount`, `buildConveraBatchRows`, `buildConveraBatchCsv`, `computeConveraBatchFilename` + types (`ConveraBatchGroup`, `ConveraBatchManualRow`, `ConveraBatchOutRow`, `InvoiceWithIban`) + constants (`CONVERA_INDIA_REF2`, `CONVERA_MULTI_INVOICE_REF1`, `CONVERA_BENENAME_MAX`=100, `CONVERA_REF1_MAX`=100, `CONVERA_POP`=Trade Related, `CONVERA_CSV_HEADER`). Tests lock: CRLF/no-BOM/no-trailing-newline; TEAL umbrella shared Ref1; India Ref2 (group + manual); 100-char caps on beneName + ref1; integer vs .XX amount format; POP always Trade Related; manual rows appended after group rows; empty rows → header-only CSV. `downloadConveraBatchCSV` shrinks 73 → 10 lines. **X6 partial:** `openConveraBatchPreview` grouping/skip-classifier/deprecated-bene redirect NOT extracted — heavy DB + state calls, deferred to CB extract. See [[convera-batch-file-extract]]. | ✅ 2026-09-18 | S6 | **−67 lines TS.tsx (10,995 → 10,928).** Cumulative arc −31.1%. Build clean; 550 pass (+34) / 6 pre-existing fail. CB now HALF-gated: CSV builder safe to consume from extracted modal; preview grouping still at wrapper. |
| **CB** | Convera Batch modal → `src/roles/Accountant/modals/ConveraBatchModal.tsx` (~350 lines pure render + drilled state per compound-temporary-state pattern) + bonus lift of 4 IBAN/ASCII helpers to `src/lib/iban.ts` (`89f6dfa`, S6, 2026-09-18). All 7 state hooks stay at wrapper (E1: cross-consumed with `openConveraBatchPreview` + `downloadConveraBatchCSV`). Types (`ConveraBatchSkip`, `ConveraBatchExcluded`, `ConveraBatchManualEditor`) live in the modal; `ConveraBatchGroup`/`ConveraBatchManualRow` imported from lib (X5+X6). `sanitizeIban`, `transliterateAscii`, `ibanChecksumValid`, `checkIbanLength` (+ `IBAN_LENGTH_BY_COUNTRY`) lifted from TS.tsx module-level to `src/lib/iban.ts` — extracted modal shouldn't import from TS.tsx per [[self-sufficient-tab]]. TS.tsx re-imports. | ✅ 2026-09-18 | S6 | **−389 lines TS.tsx (10,928 → 10,539).** Cumulative arc −33.6%. Build clean; 550 pass / 6 pre-existing fail. CSV output invariant (X5+X6 tests still lock file format). |
| **IB** | Intuit Batch modal → `src/roles/Accountant/modals/IntuitBatchModal.tsx` (~130 lines pure render, 5 props) (`801b080`, S6, 2026-09-18). All 3 state hooks stay at wrapper (`showIntuitBatchModal`, `intuitBatchInvoices` set by `openIntuitBatchPreview`; `copiedIntuitField` cross-consumed with CB modal). Bonus cleanup: `Printer` + `Copy` lucide-react imports + `CopyChip` component import removed from TS.tsx — last consumers were CB + IB modals. Plan §1b-C mentioned "IB1 kpiExpanded + IB2 sortKey/direction hooks" — stale, those hooks don't exist. Actual modal simpler than described. | ✅ 2026-09-18 | S6 | **−108 lines TS.tsx (10,539 → 10,431).** Cumulative arc −34.3%. Build clean; 550 pass / 6 pre-existing fail. |
| **🛑 STOP GATE** | QB Automation tab discussion required with Dan before X4/QA7/QA8/QA9 per [[qb-automation-stop-gate]]. Carry-in items: QbExport modal retained after X7 IIF deletion (category-card status inspector + Skip/Unskip/Confirm + `saveInvoiceExportStatus`) may factor into QB Automation UX redesign. QE/PI deps on X7 IIF need re-scope (both moot under qbXML flow). | 🛑 GATE | S6 EOD | **Waiting on Dan's talk before scoping any X4/QA slice.** |
| **Arc state** | Main `801b080`. TS.tsx 15,871 → 10,431 (−5,440, −34.3%). Test suite: 550 passing / 6 pre-existing fails unchanged. All slices through IB shipped. Invoice cluster CLOSED. IIF DELETED. InvoiceDetailModal EXTRACTED. Convera + Intuit batch flows EXTRACTED. | 🛑 gate | S6 EOD | **Next slice blocked on QB Automation talk with Dan.** |

---

## 6. Per-chunk deep dives

### Chunk 1 — Weekly tab (TS.tsx 7341–7472, ~132 lines JSX)

**Purpose in ops:** Accountant's landing view. Shows the week's approved/pending/not-submitted state at a glance, plus a KPI grid (Total Employees / Total Hours / Avg / Submission Channels). CSV export + browser Print. Prev/Next week nav.

**Consumers of this tab in daily ops:** Accountant only. Read-only view — no mutations trigger from here.

#### 1a. State + handler consumption map

| Kind | Name | Location | Also used by |
|---|---|---|---|
| useState | `reportWeek` | 1197 | (module-scope) |
| Setter | `setReportWeek` | via `changeReportWeek()` at 6109 | Weekly only |
| Pure fn | `generateReport()` | 6152 | Weekly (7166) + `downloadCSV` (6166). **Weekly-only in practice.** |
| Pure fn | `downloadCSV()` | 6165 | Weekly only (CSV button 7346) |
| Derived vars | `reportData`, `weekDates`, `grandTotal` | Computed at 7166-8 (accountant IIFE scope) | **Weekly only** — confirmed. Consolidated aliases its own `gt` (7477). Timesheet-Only declares its own `weekDates` (8876, 9048). |
| Utility | `formatDate`, `getWeekDates`, `parseLocalDate` | `src/lib/dates.ts` ✅ | shared |
| Utility | `isTestAccount` | `src/lib/isTestAccount.ts` ✅ | shared |
| Utility | `triggerDownload` | `src/lib/csv.ts` ✅ | shared |
| Global data | `users`, `timesheets`, `projects` | module-scope useState | shared |
| Component | `StickyScrollWrapper` | defined **inline** TS.tsx:9 | 4 use sites (Auth 129, Weekly 7426, Invoices 8484, Timesheet-Only 8849). **Not yet extracted.** |
| Icons | `FileText`, `Download`, `Printer` | lucide-react | already imported |

#### 1b. Uniquely-owned surface

1. KPI grid — 4 stat cards (7361–7415). Includes: submitted/pending/notSubmitted/rejected counts, test-accounts chip, submission-channel Portal vs Email split with 1-bar sparkline.
2. Weekly report table (7427–7464). Sticky first two columns (ID + Employee). Day columns generated from `weekDates`. TOTAL row.
3. Prev/Next week nav — **duplicated JSX** top (7418–7425) + bottom (7466–7470). Low-priority cleanup opportunity.
4. CSV + Print buttons (7346–7347).

#### 1c. Overlaps with cross-role atoms (candidates for shared extract)

- **StatusBadge (A10)** — inline switch at 7454 (`row.status → color`). Same pattern in ~15 other places.
- **Source pill Portal/Email** (7444–7450) — pattern also lives in Consolidated + Timesheet-Only + Invoices. A new atom `<SourceBadge source={'direct'|'imported'} />` would clean 4+ sites.
- **Day-column table** (A4 in audit) — Weekly is a smaller variant of the same pattern as Timesheet-Only + Manager All-Team (extracted) + VendorManager Team Timesheets. **Not urgent** — Weekly's variant is thin enough to live inside Weekly.tsx; extraction only pays if Timesheet-Only slice also wants it.

#### 1d. Traps / entrenched issues found in this pass

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T1 | `generateReport()` re-runs on **every render** — through 7166 (Weekly derived) + 6166 (downloadCSV closure). Not memoized. | Perf smell, functional-safe. | Wrap in `useMemo` keyed on `[timesheets, users, projects, reportWeek]` when we extract to `Weekly.tsx`. |
| T2 | `reportData/weekDates/grandTotal` live at accountant-render scope but are Weekly-only. Reader mistakes them for role-shared state. | Semantic clarity. | Move inside `Weekly.tsx` as part of the extract — they belong there. |
| T3 | Prev/Next JSX duplicated top+bottom (7418–7425, 7466–7470). Neither has been noticed for cleanup. | Trivial. | While inside `Weekly.tsx`, factor to a `<WeekNav />` local sub-component OR just leave it — it's <10 lines, twice. |
| T4 | `StickyScrollWrapper` defined inline at file top (TS.tsx:9) though it has 4 use sites. Pure wrapper, no logic. | Modularization miss. | **Prerequisite extract.** `src/components/StickyScrollWrapper.tsx`. Zero risk. |
| T5 | `downloadCSV()` internally re-calls `generateReport()` — so the CSV can theoretically diverge from the on-screen table if `reportWeek` changed mid-render (racy in principle; not observed). | Latent bug, unobservable in current usage. | When we memoize `reportData`, `downloadCSV` should accept it as arg rather than re-derive. |
| T6 | The CSV export logic (6165–6180) is inline string-building. Weekly is the ONLY caller. Not sharing with Consolidated (which has its own CSV builder). | Style/consistency, not a bug. | Ship CSV builder inside `Weekly.tsx` — no need to add a shared abstraction for a single caller. |

None of T1–T6 are bugs that affect the accountant today. They're modularization smells + a small perf smell. Zero-regression risk if left in place.

#### 1e. Carve-out sequence (proposed — for later approval, not execution)

Three commits, each independently deployable, each behind its own feature branch:

**Slice W1 — StickyScrollWrapper extraction (prerequisite for W3 and later Invoices/Timesheet-Only slices)**
- Move component definition (TS.tsx:9–~30) → `src/components/StickyScrollWrapper.tsx`.
- Add import at the four use sites (Auth 129, Weekly 7426, Invoices 8484, Timesheet-Only 8849).
- Zero behavior change.
- **Zero-regression check:** `npm run build` + eyeball dev server: any page with a scrollable table (Weekly, Timesheet-Only, Invoices, Auth's timesheet history table) should look identical.
- **Effort:** 20–30 min.

**Slice W2 — generateReport() extraction to `src/lib/reports.ts` (optional prerequisite)**
- Move `generateReport()` (6152–6163) → pure function `generateWeeklyReport({timesheets, users, projects, reportWeek}) → Row[]`.
- Both call sites (7166 + 6166) import it.
- Add a lock-in unit test capturing current output shape for a fixture week.
- **Zero-regression check:** unit test + accountant Weekly tab loads identical KPIs + table rows for the current week.
- **Effort:** 45 min.
- **Optional?** Yes — we can also keep it inline inside `Weekly.tsx` since Weekly is its sole consumer. Extracting to `lib/` only pays if a second consumer surfaces (e.g., a future Reports tab).

**Slice W3 — Weekly.tsx role extract** *(revised 2026-09-15 for self-sufficient tab principle)*
- Create `src/roles/Accountant/tabs/Weekly.tsx`.
- Props: `{ timesheets, users, projects }` — shared data only.
- **Tab-local state moved inside:** `reportWeek` useState + `changeReportWeek` handler (currently pre-role at 1197 + 6109 — Weekly is the only consumer).
- **Tab-local logic moved inside:** `generateReport()` (currently pre-role at 6152), `downloadCSV()` (currently pre-role at 6165), `reportData` / `weekDates` / `grandTotal` derivations (currently at accountant IIFE scope 7166-8).
- Memoize `reportData` via `useMemo`.
- Update accountant render to `<Weekly timesheets={timesheets} users={users} projects={projects} />`.
- Pre-role deletes: line 1197 (`reportWeek` useState), line 6109-6113 (`changeReportWeek`), line 6152-6180 (`generateReport` + `downloadCSV`).
- **Zero-regression check:**
  - Accountant login → Weekly tab loads with correct KPI numbers matching before.
  - Change week Prev/Next — table + KPIs update correctly.
  - Click CSV — download contains all rows + Grand Total row.
  - Click Print — browser print dialog opens with correct table.
  - Test-accounts chip appears when applicable.
- **Effort:** 60–90 min.

**Total Chunk 1 effort:** ~2–2.5 hrs across 3 mergeable commits. All slices leave main deployable after each.

#### 1f. Open questions

- **Q1.1** Do we bother with Slice W2 (extract `generateReport` to lib/)? Or keep it inside `Weekly.tsx` since it has one caller? → Consultant recommendation: **keep it inside `Weekly.tsx`**. Adds a directory hop for no shared consumer. If a Reports tab lands later, extract then.
- **Q1.2** Dedupe Prev/Next nav to `<WeekNav />` or leave the two blocks? → Consultant recommendation: **leave it**. Two 6-line blocks aren't worth the local abstraction; abstraction only pays with a 3rd caller.
- **Q1.3** Should we take the StatusBadge (A10) + SourceBadge shared-atom extractions inside Slice W3, or defer? → Consultant recommendation: **defer**. Chunk 9 (modals sweep + shared atoms) is where those decisions land. Weekly can wait; the coupling is one-way (badges are cheap to swap in later without another Weekly touch).

#### 1g. What this slice does NOT touch

- No handler in the pre-role section beyond `generateReport` + `downloadCSV` (both Weekly-exclusive callers).
- No shared state hook.
- No modal.
- No cross-tab wiring.

**Confidence:** high. Weekly is the safest first tab.

---

### Chunk 2 — Consolidated tab (TS.tsx 7474–7584, ~110 lines JSX + 60 lines logic at 7170–7229)

**Purpose in ops:** Multi-week/multi-month roll-up. Accountant selects a date range → sees a grid of Employees × Weeks with hours per week + status + rowTotal + grandTotal. Two CSV exports (with-status / hours-only). Project filter + Exclude-test toggle.

**Consumers in daily ops:** Accountant (heavy, monthly). Similar view exists for Manager (scoped to managed users).

#### 2a. State + handler consumption map

| Kind | Name | Location | Also used by |
|---|---|---|---|
| useState | `appliedRange`, `setAppliedRange` | pre-role | Consolidated only |
| useState | `excludeTestAccounts`, `setExcludeTestAccounts` | pre-role | Consolidated only |
| useState | `consolidatedProjectFilter`, `setConsolidatedProjectFilter` | pre-role | Consolidated only |
| useState | `showConsolidatedExportMenu` | pre-role | Consolidated only |
| Inline fn | `generateConsolidatedReport()` | 7170–7229 (accountant IIFE) | Consolidated only |
| Derived | `consolidatedReport` | 7231 | Consolidated only |
| Inline fn | `downloadConsolidatedCSV(includeStatus)` | 7475–7509 (inside Consolidated IIFE) | Consolidated only |
| Component | `ConsolidatedTable` | **inline exported at TS.tsx:59** | Manager Consolidated imports it via `from '../../TimesheetSystem'` — cross-file coupling smell |
| Component | `MonthRangePicker` | `src/components/MonthRangePicker.tsx` ✅ | Manager + VendorManager |
| Utility | `parseLocalDate`, `formatDate`, `countryName`, `isTestAccount`, `triggerDownload` | shared | shared |

#### 2b. 🚨 Major reusability finding (per Dan's directive)

**Manager's Consolidated view has already extracted the primitives but copy-pasted the logic.** Slice 3 (`da14f2e`) extracted `ManagerView` but did NOT extract the shared computation — it duplicated it.

**Compare:**
- Accountant `generateConsolidatedReport()` (7170–7229, ~60 lines) — Mon/Sun overlap → `partialWeeks` → `weekEndings` → `employeeRows` (hours/statuses/rowTotal) → `colTotals` → `grandTotal`
- Manager `generateMgrReport()` (`ManagerView.tsx` 67–109, ~43 lines) — **90% identical** — same Mon/Sun overlap, same partialWeeks, same weekEndings, same employeeRows shape, same colTotals

**Only real differences:**
1. User scope: Accountant `= all timesheetusers filtered by project/test`; Manager `= managed users`
2. Accountant adds `excludeTestAccounts` + `sourceCounts` + `excludedTestNames` return fields; Manager does not

**Same for CSV builders:**
- Accountant `downloadConsolidatedCSV(includeStatus)` (7475–7509, 35 lines)
- Manager `downloadMgrCSV()` (`ManagerView.tsx` 113–134, 22 lines) — near-identical; differs only in filename + no include-status toggle

**This is exactly the "one caller but a variation exists" pattern Dan flagged.** The correct extraction is a shared `src/lib/consolidatedReport.ts` module that takes a filter function + options and both roles call it.

#### 2c. 🐛 Traps found in this pass

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T7 | **Stale copy** — line 7578 empty-state reads "*click Apply*" but MonthRangePicker's Apply button was removed in Slice 2 (`37a161e`). User sees copy referencing a button that doesn't exist. | UX bug, ships today. | Trivial one-line fix. Manager's empty-state (line 282) already reads "*Select a month or custom date range to see the report.*" — copy that. |
| T8 | `ConsolidatedTable` (TS.tsx:59) is exported from `TimesheetSystem.tsx` and Manager imports it via `../../TimesheetSystem`. Cross-file coupling that inflates TS.tsx's public API. | Modularization smell. | Move component definition to `src/components/ConsolidatedTable.tsx`. Both consumers re-import. |
| T9 | `generateConsolidatedReport` closes over 6 module-scope variables (`timesheets`, `users`, `projects`, `appliedRange`, `consolidatedProjectFilter`, `excludeTestAccounts`) making test harnessing hard. | Testability. | Extract to pure fn accepting inputs as args (see W2-style approach). |
| T10 | Accountant's project filter select (7525–7535) does an inline `.filter(p => p.status === 'active')` — same shape appears elsewhere for project selects. | Minor. | Consider `useActiveProjects()` hook if 3+ sites; not yet. |
| T11 | `sourceCounts` computed in `generateConsolidatedReport` at 7224–7227 but no consumer in this tab uses it. Search shows `ConsolidatedTable` at TS.tsx:59 may render it. | Silent dead field? Verify. | Grep `sourceCounts` usage inside ConsolidatedTable component — if unused, drop. If used, note it. |
| T12 | Manager & Accountant use `excludeTestAccounts` semantics differently: Accountant has an explicit toggle; Manager silently doesn't apply it. Might be intentional (managers see everything they manage) — but is that decision written down? | Behavior clarity. | Ask Dan; either way, document decision. |

#### 2d. Uniquely-owned surface

1. Header row — Exclude-test checkbox + project filter select + Export CSV dropdown (with 2 options: with-status / hours-only)
2. MonthRangePicker (extracted)
3. ConsolidatedTable (extracted, but in wrong place — TS.tsx:59)
4. Empty-state message (buggy — trap T7)

#### 2e. Reusability lens findings

| Candidate | Current sites | Cross-role potential | Recommendation |
|---|---|---|---|
| **`buildConsolidatedReport()`** — pure fn | Inline in Accountant + duplicated in ManagerView | HIGH — already exists in 2 places | Extract to `src/lib/consolidatedReport.ts`. Signature: `(input: { timesheets, users, projects, range, userFilter?, excludeTest?, includeSourceCounts? }) => Report`. Manager passes `userFilter: (u) => managedIds.has(u.id)`; Accountant passes project + test filters. |
| **`downloadConsolidatedCSV()`** — CSV builder | Inline in both | HIGH — duplicated | Extract to `src/lib/consolidatedCsv.ts`. Signature: `(report, opts: { includeStatus, filenamePrefix, rangeLabel }) => void`. |
| **`ConsolidatedTable`** | Cross-file import from TS.tsx | Already cross-role | Move file location from `TS.tsx:59` → `src/components/ConsolidatedTable.tsx`. |
| **`ExportCsvMenu`** (dropdown with 2 options) | Accountant only | Not urgent — but same pattern appears in QB Automation and Payments tabs (need to verify in Chunks 7 & 8) | Defer until Chunks 7/8 confirm the second/third caller. |
| **Project filter select** (all/unassigned/active-projects) | Accountant Consolidated | Recurs in Invoices tab, likely Timesheet-Only | Note for Chunk 3 + 6 comparison. Extract once we've seen all sites. |

#### 2f. Carve-out sequence (proposed)

Four commits, sequenced for zero regression:

**Slice C1 — Fix trap T7 (stale "click Apply" copy)**
- One-line edit at 7578.
- **Zero-regression check:** load accountant Consolidated tab with no range selected → copy matches Manager's version.
- **Effort:** 5 min. Do this as a hotfix **regardless** of the larger modularization arc, since it's a user-visible bug.

**Slice C2 — Move `ConsolidatedTable` to `src/components/`**
- Cut/paste from TS.tsx:59 to new file. Update both import sites (accountant call at 7574 + Manager's `from '../../TimesheetSystem'`).
- Also verify T11: is `sourceCounts` consumed inside the table? If yes, keep field. If no, drop.
- **Zero-regression check:** build + eyeball both Manager Consolidated + Accountant Consolidated — table renders identically.
- **Effort:** 30 min.

**Slice C3 — Extract `buildConsolidatedReport()` to `src/lib/consolidatedReport.ts` + unify Manager + Accountant**
- Write pure fn with filter-injection API.
- Add unit tests locking output shape for both variants (managed-users fixture + all-timesheetusers fixture).
- Update Accountant's `generateConsolidatedReport` (7170) to delegate.
- Update Manager's `generateMgrReport` (67) to delegate.
- **Zero-regression check:** unit tests + smoke both roles' Consolidated tabs for the same date range and verify identical hours/status/totals per employee.
- **Effort:** 90 min.
- **Behavior-locking test comes FIRST** — this is not Convera, but it IS shared logic across 2 roles. Test-first prevents silent divergence.

**Slice C4 — Extract `downloadConsolidatedCSV()` to `src/lib/consolidatedCsv.ts`**
- Pure fn accepting `(report, opts)`.
- Both roles delegate.
- **Zero-regression check:** manually run each CSV export before + after, byte-diff the outputs.
- **Effort:** 45 min.

**Slice C5 — Extract Accountant Consolidated JSX to `src/roles/Accountant/tabs/Consolidated.tsx`** *(revised 2026-09-15 for self-sufficient tab principle)*
- After C1–C4 land, this tab's remaining body is ~50 lines of JSX + state hooks.
- Props: `{ timesheets, users, projects }` — shared data only.
- **Tab-local state moved inside** (all currently pre-role, all Consolidated-only): `appliedRange`, `excludeTestAccounts`, `consolidatedProjectFilter`, `showConsolidatedExportMenu`.
- Pre-role deletes: those 4 useState hooks after this slice lands.
- **Zero-regression check:** all interactions (checkbox / project select / range change / both CSV variants) work identically.
- **Effort:** 60 min.

**Total Chunk 2 effort:** ~3.5 hrs across 5 commits. Each independently mergeable.

#### 2g. Open questions

- **Q2.1** T12 — is Manager's *lack* of `excludeTestAccounts` intentional or drift? Consultant guess: intentional (managers manage real people, no test accounts to filter). But want confirmation before shared-lib default behavior is codified.
- **Q2.2** T11 — is `sourceCounts` used by `ConsolidatedTable` or dead? Answered by reading component source during C2.
- **Q2.3** Should C1 (stale "Apply" copy) be pulled out to its own hotfix commit right now (before the modularization arc even starts), or bundled into C5? Consultant recommendation: **pull it out as a hotfix now** — it's a shipping UX bug, cost is 5 min.

#### 2h. What this chunk does NOT touch

- No shared state hook beyond consolidation-specific state.
- No modal.
- No cross-role coupling other than the intentional shared-lib extraction.
- No touch to VendorManager (VM has its own Billing Period picker, different shape — not a Consolidated variant).

**Confidence:** high, with the caveat that Slice C3 needs behavior-locking tests before merge because two roles now depend on the shared logic.

---

### Chunk 3 — Timesheet-Only tab (TS.tsx 8857–9086, ~229 lines)

**Purpose in ops:** Accountant's view of timesheets for `timesheetuser` accounts that do NOT have `invoiceEnabled` (i.e., paid outside the system — Arpit, Himavath, etc. per [[no-invoice-contractors]]). Multi-select user filter + date range + Mon–Sun day-column table + CSV export. Row-click opens the shared TimesheetDetailModal.

**Consumers in daily ops:** Accountant. Used monthly-ish for reconciling non-invoice contractors.

#### 3a. State + handler consumption map

| Kind | Name | Location | Also used by |
|---|---|---|---|
| useState | `tsOnlySelectedUsers` | pre-role | TS-Only only. Nullable — lazy-init "all users" via `??` pattern (see T14) |
| useState | `tsOnlyApplied` | pre-role | TS-Only only |
| useState | `tsOnlyDropdownOpen` | pre-role | TS-Only only |
| useState | `tsOnlySearch` | pre-role | TS-Only only |
| Handler | `openTimesheetModal` | pre-role 6207 | **Cross-role:** shared with Weekly + Manager (passed as prop at 7119) |
| Inline fn | `exportTsOnlyCSV` | 8871–8887 (IIFE-local) | TS-Only only |
| Inline fn | `filteredTs`, `searchedUsers`, `toggleUser` | 8863–8895 (IIFE-local) | TS-Only only |
| Component | `MonthRangePicker` + `buildMonthPresets` | ✅ extracted, `src/components/` | Cross-role (5 sites) |
| Component | Day-column table | **inline** 9021–9080 | 4+ sites (see reuse lens) |
| Component | Multi-select dropdown | **inline** 8923–8988 | 4× accountant alone (B2 in audit) |
| Utility | `getWeekDates`, `parseLocalDate`, `formatDate`, `countryName`, `triggerDownload` | ✅ shared | shared |

#### 3b. 🚨 Major reusability finding

**Two shared-atom candidates with high ROI:**

1. **B2 Multi-select dropdown** — accountant alone has 4 sites of nearly-identical code (audit: Invoice contractor picker 9,222; TS-Only 8,923; Convera Matching implicit; Payment Import unmatched 14,005). The TS-Only version (65 lines: search input + Select all/Clear + list + Done) is the cleanest reference implementation. Extract once, drop the other 3 in later slices.

2. **A4 Day-column timesheet table** — inline version here (60 lines) is **the same pattern** as:
   - Weekly (TS.tsx 7427–7464)
   - Manager All-Team (already in `ManagerView.tsx`, drift copy)
   - VendorManager Team Timesheets (already in `VendorManagerView.tsx` line 274-291 — VERIFIED as drift copy: Mon/Tue/... columns hardcoded, same `weekDates.map` shape)

   **Same story as Chunk 2's Consolidated.** Slice 3 (Manager) and Slice 5 (VendorManager) each copy-pasted the day-column table instead of extracting to shared. Now 4 drift copies exist. Per [[reusability-lens]], the corrective extraction covers all 4 in one compound slice.

**Differences between the 4 variants (defensible tweaks, not blocking a shared component):**
- Header color: indigo (Weekly, TS-Only, Manager) vs teal (VendorManager)
- Checkbox column: Manager only (bulk-approve)
- Sticky first-cols: Weekly only
- Row click behavior: TS-Only opens modal; Weekly is read-only; Manager row is bulk-select-toggle target

All expressible as props on a single component.

#### 3c. 🐛 Traps found

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T13 | `openTimesheetModal` is a shared handler already passed as prop into `Manager` (7119). When Accountant tabs get extracted, TS-Only.tsx must receive it the same way. Standard prop-drill. | None — just a note. | — |
| T14 | `tsOnlySelectedUsers` starts `null`, lazy-inits to "all users" via `?? tsOnlyUsers.map(...)`. **Stale-set risk:** if `users` array grows (new user added mid-session), previously "all" is now "all-except-new". Small; may or may not be visible to accountant. | Low. Latent. | On extract, either eagerly initialize from `users` via `useEffect`, or explicitly re-mean "all" as `null` sentinel and document. |
| T15 | Weird CSV template-literal formatting at 8883–8884 — backtick spans two lines with a literal `\n` that IS the row terminator. Works, visually confusing. | Cosmetic. | Fix during extract: use `csv += \`...\`+ '\n';` for readability. |
| T16 | `exportTsOnlyCSV` redefined every render (inline in IIFE). Perf non-issue but style. | Cosmetic. | On extract, hoist as `useCallback` or `src/lib/`. |
| T17 | Weekday headers hardcoded `Mon/Tue/Wed/.../Sun` (9030–9036) rather than derived from `weekDates`. Ties the table to Mon-start weeks. | Latent — our system IS Mon-start, no immediate risk. | Derive from `weekDates` in the shared A4 component. |
| T18 | `autoFocus` on the search input inside the dropdown (8947). If dropdown mounts while another input is focused (unlikely but possible), focus steals. | Low. | Leave for now. |

None ship a bug today.

#### 3d. Uniquely-owned surface

1. Multi-select user picker (65 lines) — 🎯 B2 candidate
2. Custom Bi-Weekly + Month preset config for MonthRangePicker (9002–9014) — TS-Only-specific, unique. Fine as-is (`MonthRangePicker.presets` prop already supports this pattern).
3. CSV export logic (`exportTsOnlyCSV`) — TS-Only-specific rollup (per-timesheet row, not per-user weekly). Different enough from Consolidated CSV that a shared abstraction likely isn't worth it.

#### 3e. Reusability lens candidates (roll-up)

| Candidate | Sites | Rec |
|---|---|---|
| **B2 MultiSelectDropdown** | 4× accountant | Extract to `src/components/MultiSelectDropdown.tsx` — high ROI. Timesheet-Only version is the cleanest reference. |
| **A4 TimesheetDayTable** | Weekly + TS-Only + Manager (drift copy) + VendorManager (drift copy) | Extract to `src/features/TimesheetDayTable/` — compound slice, corrective for the Slice-3/Slice-5 copy-pastes. Behavior-locking tests non-negotiable. |
| **A10 StatusBadge** | 15+ sites | Chunk 9 |
| **SourceBadge** (Portal/Email pill) | Weekly + TS-Only + likely Invoices | Extract as `src/components/SourceBadge.tsx` (~15 lines) |

#### 3f. Carve-out sequence

**Slice T1 — B2 MultiSelectDropdown extraction (foundation)**
- Move to `src/components/MultiSelectDropdown.tsx`
- Props: `{ options: {id, label, meta?}[], selected: string[], onChange, placeholder, searchable?, doneLabel?, className? }`
- Update TS-Only call site
- Leave other 3 accountant sites (Invoice contractor picker, Convera Matching, Payment Import unmatched) untouched **for now** — they'll fall in Chunks 6, 7, and modals sweep respectively. Extract-once, replace-N-times.
- **Zero-regression check:** TS-Only picker — search filter works, Select all / Clear work, checkbox toggle works, Done closes.
- **Effort:** ~2 hrs (design + extract + this consumer).

**Slice T2 — SourceBadge extraction (trivial)**
- `src/components/SourceBadge.tsx`
- Sites (Chunk 3 pass): Weekly, TS-Only. Anticipate 2+ more when Chunks 6/others reveal them.
- **Effort:** 30 min.

**Slice T3 — A4 TimesheetDayTable extraction (COMPOUND, corrective) — Chunk 3's biggest**
- Move to `src/features/TimesheetDayTable/` (or `src/components/TimesheetDayTable.tsx` if simple enough)
- Props: `{ rows, headerColor: 'indigo'|'teal', showId?, sticky?, showCheckbox?, selectedIds?, onToggleSelect?, onRowClick?, showStatus?, showSource? }`
- Write behavior-locking snapshot tests: input `rows` fixture → matching HTML per variant
- Migrate 4 consumers: Weekly (accountant), TS-Only (accountant), Manager All-Team (`ManagerView.tsx`), VendorManager Team Timesheets (`VendorManagerView.tsx`)
- Because 2 of the 4 consumers are in ALREADY-EXTRACTED role files, this slice touches Manager + VendorManager code too. Corrective per [[reusability-lens]] — bundling avoids re-drift.
- **Zero-regression check:**
  - Test suite matches snapshots
  - Manual: log in as each of the 4 role views, verify identical table appearance, click a row (opens modal in TS-Only/Weekly; toggles select in Manager), Select all row for Manager still works
- **Effort:** ~5–6 hrs. Biggest single slice in Chunk 3. Test-first mandatory.

**Slice T4 — Timesheet-Only tab role extract** *(revised 2026-09-15 for self-sufficient tab principle)*
- Create `src/roles/Accountant/tabs/TimesheetOnly.tsx`
- After T1–T3 land, remaining body is thin (state hooks + a bit of glue + `<MultiSelectDropdown>` + `<MonthRangePicker>` + `<TimesheetDayTable>` + `exportTsOnlyCSV`)
- Props: `{ users, timesheets, projects, openTimesheetModal }` — shared data + cross-role handler only.
- **Tab-local state moved inside** (all currently pre-role, all TS-Only-only): `tsOnlySelectedUsers`, `tsOnlyApplied`, `tsOnlyDropdownOpen`, `tsOnlySearch`.
- Pre-role deletes: those 4 useState hooks after this slice lands.
- **Zero-regression check:** all interactions work identically; CSV export still produces same byte-for-byte content
- **Effort:** ~60 min

**Total Chunk 3 effort:** ~8 hrs across 4 slices. Slice T3 is the whopper — behavior-locking tests must land first.

#### 3g. Open questions

- **Q3.1** T3 is a corrective compound slice touching Manager + VendorManager role files. Do we do it as one commit, or split (extract to `src/features/`, ship, then per-role migration commits)? Consultant rec: **split** — one commit adds the new feature module + tests + migrates one role (TS-Only or Weekly); subsequent commits migrate one role at a time so blast radius per commit stays tiny.
- **Q3.2** Should we introduce `src/features/` at all (as audit suggests) or keep the shared table under `src/components/`? Consultant rec: **`src/components/`** for now — the day-column table has zero smart state; it's pure display. `src/features/` earns its keep when smart state + fetching enters the mix (see: Invoice workbench in Chunk 6).
- **Q3.3** T14 (`tsOnlySelectedUsers` lazy-null-init) — is this a real bug worth fixing during T4, or leave alone? Consultant rec: **fix at extract time** — cheap, and clearer semantics for a future reader.

#### 3h. What this chunk does NOT touch

- No pre-role shared handler beyond `openTimesheetModal` (which already flows via prop pattern)
- No modal
- No Convera / QB code

**Confidence:** high on T1/T2/T4. Medium on T3 (compound, cross-role, needs tests first).

---

### Chunk 4 — Client Estimation tab (TS.tsx 7586–8116, ~530 lines) + ClientInvoiceModal (~14225–~14545, ~320 lines)

**Dan's note (2026-09-15 S1):** *"Client Estimation is not being used a lot right now."*
That reframes the analysis. Full carve-out sequence proposed below, but §4h presents three options gated on **usage classification** (§4a).

**What this feature does:**
The accountant selects a month → sees per-project grids of engagements × weeks with hours per week (colored by source: actual/estimated/outside/override) → can generate a printable client invoice OR export/import corrected XLSX to override hours. Data comes from `clients`, `client_engagements`, `hour_overrides` tables (loaded eagerly at accountant login).

Bigger than initial estimate: **~940 lines total** across tab (530) + modal (320) + state hooks (~85) + data loading (~4).

#### 4a. 🔴 Usage classification — needs Dan's confirmation

Before choosing a modularization path, classify current usage. Three plausible states:

| State | Definition | Right response |
|---|---|---|
| **(a) Active, low-volume** | Used monthly by accountant for 1+ clients. Business feature in genuine use. | **Path A** — full modularization, but effort proportional. Skip behavior-locking tests for the low-risk portions. |
| **(b) Prototype / parked** | Built but paused. No live use. Might be revived. | **Path B** — lightweight encapsulation. Move to `src/roles/Accountant/tabs/ClientEstimation/` as-is, minimal cleanup. Stop it polluting TS.tsx; don't invest in refactoring internals. |
| **(c) Superseded / defunct** | Not used anymore. No plan to revive. | **Path C** — deletion. Archive to `.claude/archive/deprecated-2026-09-client-estimation.md` per [[archive-deleted-code]]. Removes ~940 lines + `estimationImportPreview` state + `clients` / `client_engagements` / `hour_overrides` data loads + XLSX round-trip complexity. |

**Ask Dan (Q4.1):** which classification? Answers ripple through all sub-slices.

#### 4b. State + handler consumption map

| Kind | Name | Location | Also used by |
|---|---|---|---|
| useState | `estimationMonth` | 1050 | This tab only |
| useState | `estimationClients` | 1055 | Tab + ClientInvoiceModal |
| useState | `estimationEngagements` | 1066 | Tab only |
| useState | `estimationLoading`, `estimationError` | 1067 | Tab only |
| useState | `estimationOverrides` | 1070 | Tab only |
| useState | `estimationImportPreview`, `estimationImportApplying` | 1071, 1075 | Import preview sub-modal (inside tab body) |
| useState | `estimationSort` | (missed line, ~1050s) | Tab only |
| Type | `ClientInvoiceModalState`, `ClientInvoiceLine` | 1101, elsewhere | Tab + modal (both consumers) |
| useState | `invoiceModal` (ClientInvoiceModal state) | 1114 | Tab writes, modal reads |
| Data load | `clients`, `client_engagements`, `hour_overrides` queries | 1537-1539 (eager on accountant login) | This feature only |
| Component | ClientInvoiceModal (portal-mounted) | 14225-14545 | Tab only |
| Modal | Import preview sub-modal | 8037-8113 (inline in tab body) | Tab only |
| Utility | `XLSX` library | imported | Also used in Payment Import (Intuit XLSX) |

#### 4c. Uniquely-owned surface (large)

1. **Complex date arithmetic** in UTC: month prev/next, Mon-Fri weekly bucketing (7612–7637), day-in-range checks
2. **`cellFor()` business logic** (7642–7653): `actual` if hours logged, else `estimated = max(8, monthly max day)`, else `outside/override`. Non-obvious rule.
3. **XLSX round-trip contract**: hidden id columns (A, B) + hidden week_start metadata row (row 5) → export → user edits → import diffs against current → confirmation modal → upsert to `hour_overrides`
4. **Sortable table headers** with tri-state icon (asc/desc/inactive)
5. **Generate Invoice** button that constructs `ClientInvoiceLine[]` from grid + opens ClientInvoiceModal with client-specific metadata
6. **Portal-mounted invoice modal** (~320 lines) with format-specific rendering (`genworth`, `ae_tv`, `apfm`) + retention/investment-credit math

#### 4d. 🐛 Traps found

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T19 | Extensive UTC-based date arithmetic (`Date.UTC`, `getUTCDate`, `toISOString().slice(0,10)`) mixed into a codebase whose CLAUDE.md convention is `parseLocalDate()` for local dates. In this specific tab UTC is *correct* because month boundaries need to be timezone-agnostic (client-facing invoices), but the divergence is undocumented. | Documentation. | Add code comment explaining UTC choice on extract. |
| T20 | Business rule "estimated hours = `max(8, monthlyMax)`" is buried in `cellFor()` with no test lock-in. Any refactor could silently drift it. | Test gap. | Behavior-locking test on `cellFor()` at pure-fn extract time. |
| T21 | XLSX round-trip contract (hidden id cols + hidden metadata row) is a **data-integrity boundary** with zero tests. If someone reformats the export, imports silently fail with a generic error. | Test gap + coupling. | Test the export→import round-trip on a fixture at extract time. |
| T22 | `estimationSort` state (col + dir) lives at module scope but is only used by this tab. | Semantic scope. | Move inside tab component on extract. |
| T23 | **Dead code** — `engagementsByClient` map computed at 7655 but never read. `engagementsByProject` (7665) is what's used. | Dead. | Delete during extract. |
| T24 | **Dead code** — `orphanEngagements` populated at 7674 but never rendered anywhere in the tab. | Dead. | Delete or add "Orphan Engagements" section if intended. |
| T25 | Client-invoice math (retention / sales tax / investment credit) is in the modal but its inputs are seeded from the tab's `estimationOverrides` + engagement `bill_rate`. Coupling is one-way but tests would need to span both. | Coupling. | Extract shared math to `src/lib/clientInvoice.ts` with tests before Path A. |
| T26 | `clients / client_engagements / hour_overrides` queries fire on **every accountant login** (1537–1539), even if the accountant never opens this tab. ~4 unnecessary round-trips per session. | Perf smell. | If Path A or B: lazy-load on tab open. If Path C: delete the queries. |
| T27 | ClientInvoiceModal is portal-mounted at the outer accountant render, but its state (`invoiceModal`) is written by the tab. Physically decoupled, logically coupled. | Modularization smell. | Extraction naturally colocates them under `src/roles/Accountant/tabs/ClientEstimation/`. |

#### 4e. Reusability lens candidates

| Candidate | Sites | Rec |
|---|---|---|
| Weekly bucketing (`Mon-Fri` buckets, edge trimming) | Client Estimation only | Local, keep in-file unless a 2nd caller surfaces |
| `cellFor()` with source classification | Client Estimation only | Local, but extractable as pure fn for testability |
| XLSX round-trip pattern (hidden meta + diff-preview modal) | Client Estimation only | Local. Payment Import uses XLSX but different shape. No cross-role reuse. |
| SortableHeader (asc/desc/inactive icon) | Same pattern in Client Estimation + Invoices tab + Payments + Missing QB Bills + Beneficiaries + Admin allocations (6+ per audit B4) | 🎯 Extract to `src/components/SortableHeader.tsx`. Same as B4 in audit. |
| Portal-mounted modal wrapper | ClientInvoiceModal is one of 3+ portal-mounted modals in TS.tsx | Cross-cutting; defer to Chunk 9 modals sweep |
| Currency formatter (`Intl.NumberFormat` USD) | Inline in this tab + likely Invoices, ClientInvoiceModal, Payments | Cheap util → `src/lib/currency.ts` with `formatUsd(n, opts?)`. Trivial. |

#### 4f. Modal inventory update (correction to §4b of this plan doc)

**I under-counted modals in the initial map.** ClientInvoice (portal-mounted, ~14225) was missed. Corrected count: **8 inline / portal-mounted accountant modals** + 3 already extracted (Vendor decision, QB preview, QB status pane) + TimesheetDetailModal cross-role (extracted). Also the Import preview sub-modal (8037-8113) is a **9th** inline modal but lives INSIDE the tab body — not top-level. Total 9 accountant-owned modals matches the audit.

#### 4g. Path A — Full modularization (if usage = "active, low-volume")

**Slice CE1 — Housekeeping: drop dead code + fix T22 sort scope**
- Remove `engagementsByClient` (T23), `orphanEngagements` (T24) — verify they're truly unused.
- Move `estimationSort` state inside the tab-scope component when extracted.
- **Effort:** 30 min. Independent, safe.

**Slice CE2 — Lazy-load estimation queries (T26)**
- Move the 3 estimation queries out of the eager accountant-login load (1537–1539) into an on-tab-open effect.
- **Zero-regression check:** open tab as accountant → data loads correctly → don't-open-tab → verify queries did NOT fire (network tab).
- **Effort:** 45 min.

**Slice CE3 — Extract pure logic to `src/lib/clientEstimation.ts`**
- Pure functions: `bucketWeekdays(monthStart, monthEnd)`, `computePerDayHours(userId, timesheets, monthStart, monthEnd)`, `cellFor(userId, day, actuals, user)`.
- Lock behavior with unit tests (T20).
- **Effort:** 90 min.

**Slice CE4 — Extract client-invoice math to `src/lib/clientInvoice.ts`**
- Retention / sales tax / investment-credit calculations moved out of ClientInvoiceModal.
- Format-specific dispatch (`genworth` / `ae_tv` / `apfm`) stays a rendering concern in the modal, math is pure.
- Behavior-locking tests.
- **Effort:** 90 min.

**Slice CE5 — Extract XLSX round-trip to `src/lib/clientEstimationXlsx.ts` with round-trip test (T21)**
- Export shape + import parse in one module. Round-trip fixture test.
- **Effort:** 90 min.

**Slice CE6 — Extract ClientInvoiceModal to `src/roles/Accountant/modals/ClientInvoiceModal.tsx`**
- Portal mount moves with it.
- Modal imports pure math from `src/lib/clientInvoice.ts`.
- **Effort:** 90 min.

**Slice CE7 — Extract ClientEstimation tab + import preview sub-modal to `src/roles/Accountant/tabs/ClientEstimation/`**
- Directory (not single file) because tab + sub-modal + local components.
- **Effort:** 90 min.

**Slice CE8 (opportunistic) — Extract SortableHeader to `src/components/SortableHeader.tsx`**
- Also swap in the Invoices/Payments/Beneficiaries call sites while we're here — but only if those aren't scheduled for their own chunks.
- **Effort:** 90 min including 4-5 call-site swaps. Optional / defer to Chunk 9 sweep.

**Total Path A effort:** ~10–12 hrs across 7 slices.

#### 4h. Path B — Lightweight parking (if usage = "prototype / parked")

Compress into 2 slices:

**Slice CEP1 — Housekeeping (same as CE1) + lazy-load (same as CE2) + drop dead code**
- **Effort:** ~1 hr.

**Slice CEP2 — Move tab + modal + state hooks + queries to `src/roles/Accountant/tabs/ClientEstimation/` folder as-is**
- Single directory encapsulation. No pure-fn extraction, no tests, no shared-atom extraction.
- Just: TS.tsx no longer holds it; `ClientEstimation/index.tsx` + `ClientEstimation/ClientInvoiceModal.tsx` do.
- If a caller ever needs to revive/expand, that team has a clean starting point.
- **Effort:** ~2 hrs.

**Total Path B effort:** ~3 hrs across 2 slices.

#### 4i. Path C — Deletion (if usage = "superseded / defunct")

**Slice CED1 — Archive + delete**
- Write `.claude/archive/deprecated-2026-09-client-estimation.md` capturing: what it did, why we built it (rationale from Dan), what replaced it (if anything), the business rules (`estimated = max(8, monthlyMax)`, XLSX round-trip contract).
- Delete: tab render block (7586-8116), ClientInvoiceModal (14225-14545), estimation-related state hooks (1050–1075, 1101, 1114), data queries from initial load (1537–1539), imports (Building2, ChevronLeft, ChevronRight if unused elsewhere).
- Ask Dan whether to keep the DB tables (`clients`, `client_engagements`, `hour_overrides`) — those might be reused if the feature returns, or dropped in a follow-up migration.
- **Effort:** 90 min. Highest deletion ROI in the entire modularization arc.
- **Zero-regression check:** accountant login → no runtime errors from missing state. Other tabs load normally.

#### 4j. Open questions

- **Q4.1** *Usage classification (a/b/c)?* — GATES all subsequent work in Chunk 4.
- **Q4.2** If Path B or C: what should happen to `clients` / `client_engagements` / `hour_overrides` DB tables? Preserve, drop, or use elsewhere?
- **Q4.3** If Path A or B: does the ClientInvoiceModal have other callers (Manual Invoice flow uses a DIFFERENT template — verify)? Consultant recall: [[project_manual_invoice_2026_09]] Manual Invoice uses Convera bene card, not a ClientInvoiceModal. Different feature. Confirming ClientInvoiceModal is single-consumer.
- **Q4.4** T27 (portal-mount decoupling from state) — do we care to keep the portal after extract, or move to normal in-tree mount? Consultant rec: **keep portal** if the modal genuinely needs to render above other modals. Otherwise, drop.

#### 4k. What this chunk does NOT touch

- No Convera / QB pipeline.
- No shared handler in pre-role section beyond the eager DB queries (CE2 addresses those).
- No cross-role component (except opportunistic SortableHeader in CE8 — deferrable to Chunk 9).

**Confidence:** high on the analysis. Path B locked (Q4.1 resolved 2026-09-15).

---

### Chunk 5 — Payment Profiles tab (TS.tsx 11561–11769, ~209 lines)

**Purpose in ops:** Central control panel for contractor payment profiles. Search + 4 filter chips (all / multiple / unmatched / no-qb-vendor) + expandable per-contractor groups + inline QB vendor autocomplete + Convera beneficiary relink + Delete + New profile + From-template import. **Heavy daily-use surface** — every new contractor's onboarding touches this.

**Consumers:** Accountant. Convera beneficiary state is shared with the Payment Import modal.

#### 5a. State + handler consumption map

| Kind | Name | Location | Also used by |
|---|---|---|---|
| useState | `profileTabSearch`, `profileTabFilter`, `profileTabExcludeTest` | pre-role | Payment Profiles only |
| useState | `expandedProfileUsers` (Set<string>) | pre-role | Payment Profiles only |
| useState | `qbVendorEditingId`, `qbVendorEditValue` | pre-role | Payment Profiles + **QB Automation** (12493 — same inline edit pattern reused) |
| useState | `editingProfile`, `profileEditUserId`, `profileForm`, `showProfileModal` | pre-role | **Cross-role:** Accountant PP tab + VM (already passed as props at 7142) + TimesheetUser invoice-create flow |
| useState | `beneficiaryOverrideProfileId` | pre-role | Payment Profiles + PaymentImport modal (state coupling — T29) |
| Handler | `saveQbVendorName(profileId, raw)` | pre-role 3910 | Payment Profiles + QB Automation (12493) |
| Handler | `deletePaymentProfile(id, name)` | pre-role 4619 | Payment Profiles + **Invoice Detail modal** (13499, cross-tab) |
| Handler | `openTemplateProfileModal(userId)` | pre-role 4641 | Payment Profiles only |
| Handler | `emptyProfileForm()` | pre-role 1451 | Payment Profiles + VM (passed prop 7148) |
| Handler | `loadConveraBeneficiaries` | pre-role | Payment Profiles + Import Beneficiaries button |
| Handler | `setSelectedInvoice + setShowInvoiceModal` | pre-role | Cross-tab: Payment Profiles Last-Used link + Invoices tab (primary owner) |
| Cross-modal setter | `setConveraTab('beneficiaries') + setShowConveraModal(true)` | 11620 | Import Beneficiaries entry point into PaymentImport modal (T28) |
| Data | `paymentProfiles`, `invoices`, `users`, `converaBeneficiaries` | module scope | shared |

#### 5b. Uniquely-owned surface

1. Expandable groups per contractor (`expandedProfileUsers` Set + expand-all / collapse-all)
2. QB Vendor inline editor with Enter/Escape shortcuts + datalist autocomplete (`qb-vendor-suggestions`)
3. VendorManager "team size" badge (11658-11665) — only rendered in this tab
4. IBAN/acct tail formatting (`IBAN ····XXXX` / `acct ····XXXX`) — one-off; low reuse

#### 5c. 🚨 Reusability lens findings — MULTIPLE strong candidates

| Candidate | Sites | Rec |
|---|---|---|
| **B3 FilterPills** (search + chips row) | 7+ sites across accountant (this + Invoices + Payments state pills + Payment Profiles filter pills + QB Automation + Beneficiary filter pills, per audit) | 🎯 Extract to `src/components/FilterPills.tsx`. Payment Profiles version is a clean reference. |
| **B5 AutocompletePicker** (inline QB Vendor edit with datalist) | 4× accountant (this tab 11696, QB Automation 12493, QB Export modal 13156, Convera Matching 13579, Payment Import unmatched 14014, per audit) | 🎯 Extract to `src/components/AutocompletePicker.tsx`. THIS tab is the reference impl for QB vendor autocomplete. |
| **A6 PaymentProfileModal** | Accountant PP + VM (prop-drilled) + TimesheetUser invoice-create | 🎯 Extract to `src/components/PaymentProfileModal.tsx` with `mode: 'basic' \| 'full'`. **Compound cross-role slice** — 3 consumers. |
| **Expandable-row pattern** (Set<string> of expanded IDs + toggle) | This tab + Invoices umbrella groups + QB Automation month rollup | Extract as `useExpandableRows()` hook or `<ExpandableSection>` — Chunk 9 sweep. Low urgency. |

**Note on A6:** Per the modularization backlog memo, VM's PaymentProfileModal state is passed via prop-drill from TS.tsx into VendorManager (24 props total). Extracting A6 to `src/components/` would eliminate several of those props. Additive benefit not just to Accountant.

#### 5d. 🐛 Traps found

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T28 | Import Beneficiaries button at 11620 reaches into PaymentImport-modal state via `setConveraTab('beneficiaries'); setShowConveraModal(true); loadConveraBeneficiaries()`. String-tag switch is fragile; also see Slice M0 spec in modularization-audit which plans to split PaymentImport into two distinct modals. | Coupling. | When Slice M0 lands (Chunk 9), this becomes `<ImportConveraBeneficiaries open onClose />` with dedicated state. Don't fix in isolation; align with M0. |
| T29 | `beneficiaryOverrideProfileId` written here, consumed by the Convera Matching / PaymentImport modal via read-side effect. Cross-modal state, no explicit API. | Coupling. | Same alignment with Slice M0 rework. |
| T30 | Filter reducers 11584-11586 duplicate the "no-profile OR any-profile-missing-X" pattern 3× inline. | Cosmetic. | Small helper `needsField(g, field)` on extract; not urgent. |
| T31 | `qbVendorSuggestions` recomputed every render (11589). | Perf smell. | `useMemo` on extract. |
| T32 | `qbVendorEditingId` + `qbVendorEditValue` state lives at module scope but is written/read only by this tab AND QB Automation (12493) — dual consumer. | Semantic scope. | On extract of B5 AutocompletePicker, either (a) each caller owns its own edit state, or (b) `useVendorEditor()` hook. Consultant rec: **per-caller state** — the two consumers are logically independent. |
| T33 | Last-Used column at 11726 opens InvoiceDetail via `setSelectedInvoice + setShowInvoiceModal`. Cross-tab modal reuse. | Not wrong, but coupling to note. | Handle when Invoices chunk (6) restructures InvoiceDetail. |
| T34 | `Fragment` at 11647 — need to confirm import path exists. | Trivial. | Should already `import { Fragment } from 'react'`. Verify on extract. |
| T35 | Search input has no debounce; entire groups[] recomputed on every keystroke. For ~200 contractors × per-profile logic, latency noticeable. | Perf. | `useDeferredValue` on the search string during extract. |

#### 5e. Carve-out sequence

**Slice PP1 — B3 FilterPills extraction (foundation, high reuse ROI)**
- New file `src/components/FilterPills.tsx`.
- Props: `{ options: {value: string; label: string; count?: number}[]; selected: string; onChange: (v: string) => void; className? }`
- Update Payment Profiles call site (11606-11612).
- Leave other 6+ sites for later chunks — extract once, consume incrementally.
- **Zero-regression check:** Payment Profiles 4-chip row selects filters, counts show correctly, active state styled.
- **Effort:** 90 min.

**Slice PP2 — B5 AutocompletePicker extraction (foundation, high reuse ROI)**
- New file `src/components/AutocompletePicker.tsx`.
- Props: `{ value: string; onSave: (v: string) => void; onCancel: () => void; suggestions: string[]; placeholder?: string; autoFocus?: boolean; datalistId?: string; className? }`
- Update Payment Profiles call site (11696-11722).
- Leave QB Automation, QB Export, Convera Matching, Payment Import for their chunks.
- **Zero-regression check:** QB Vendor edit — click to enter, type to autocomplete against datalist, Enter saves, Escape cancels, ✓ button saves, ✕ button cancels.
- **Effort:** 90 min.

**Slice PP3 — A6 PaymentProfileModal cross-role extraction (COMPOUND, corrective)**
- New file `src/components/PaymentProfileModal.tsx`.
- Props: `{ open, mode: 'basic' \| 'full', form, setForm, editingProfile, onSave, onCancel, hideFields?: string[], showCompanyAddress?, showConveraBeneficiary?, showQbVendorName?, showCombinePayments?, ... }` OR simpler `mode`-based field-visibility.
- Migrate 3 consumers: Accountant PP + VendorManager (currently prop-drills the state) + TimesheetUser (invoice-create flow).
- **Behavior-locking tests mandatory** — 3 role consumers, cross-cutting state.
- **Zero-regression check per role:**
  - Accountant: New / Edit / Save / Delete flows — all 16 fields round-trip. isDefault, combinePayments, converaBeneficiaryId, qbVendorName all correctly persist.
  - VendorManager: Minimal-field mode works. Only shows relevant subset.
  - TimesheetUser: Invoice-create flow's payment-profile picker still saves + selects.
- **Effort:** ~3 hrs (design + extract + 3-consumer migration + tests).
- **Bonus benefit:** VM prop count drops from 24 → ~18.

**Slice PP4 — Extract Payment Profiles tab to `src/roles/Accountant/tabs/PaymentProfiles.tsx`**
- After PP1-PP3 land, remaining body is thin JSX + local state.
- Props from accountant wrapper: `{ users, paymentProfiles, invoices, converaBeneficiaries, saveQbVendorName, deletePaymentProfile, openTemplateProfileModal, setSelectedInvoice, setShowInvoiceModal, ... }`
- Local state on tab: `profileTabSearch`, `profileTabFilter`, `profileTabExcludeTest`, `expandedProfileUsers`, `qbVendorEditingId`, `qbVendorEditValue` (moving from module scope per T32)
- Fix T31 (memo `qbVendorSuggestions`) + T35 (`useDeferredValue`) during extract.
- **Zero-regression check:** all filter chips work; search + debounce works; expand/collapse all; QB vendor inline edit; Re-link to beneficiary; Delete confirms; New profile opens A6; From template opens template modal; Last-Used opens Invoice Detail.
- **Effort:** ~90 min.
- **Defer to Chunk 9:** T28/T29 PaymentImport-modal coupling.

**Total Chunk 5 effort:** ~7-8 hrs across 4 slices. PP3 is the compound cross-role one.

#### 5f. Open questions

- **Q5.1** PP1 & PP2 order — extract both before PP3, or interleave? Consultant rec: **PP1 → PP2 → PP3 → PP4**, sequential. PP1 & PP2 are drop-in atoms; PP3 depends on PP1 (chip rows inside modal? no, not really) but they're independent. Either order for PP1/PP2 is fine.
- **Q5.2** PP3 A6 field-visibility API — `mode: 'basic' \| 'full'` (simpler) or explicit `showX / showY` props (more granular)? Consultant rec: **`mode` with 2-3 preset variants**. If we later need custom variants, add a 3rd mode; don't over-engineer.
- **Q5.3** T32 — `qbVendorEditingId` state at module scope. On PP4 extraction, do we keep it dual-consumer (PP tab + QB Automation) via a shared hook, or split into per-caller state? Consultant rec: **split**. The two contexts never share an active edit (they're on different tabs), so per-caller state is cleaner and eliminates a shared-state coupling.

#### 5g. What this chunk does NOT touch

- No Convera / QB pipeline handlers.
- No shared handler edits — `saveQbVendorName`, `deletePaymentProfile`, `openTemplateProfileModal`, `emptyProfileForm` all stay in pre-role section (they're cross-tab).
- No pre-role state removal until PP4 owns the tab-local hooks.
- No touch to VM or TimesheetUser role files EXCEPT during PP3 (compound cross-role).

**Confidence:** high on PP1, PP2, PP4. Medium-high on PP3 (compound, cross-role, needs tests first).

---

### Chunk 6 — Invoices tab (TS.tsx 8118–8856, ~739 lines)

**Purpose in ops:** The accountant's invoice workbench. Heavy daily use. Filter across ~9 axes → KPI cards → grouped invoice mega-table (13 columns, umbrella groups) → per-row + batch actions. Opens **six modals** (Manual Invoice, Convera Matching, Convera Batch, Intuit Batch, QB Export, Invoice Detail) + one already-extracted (Manual Invoice modal was extracted per [[manual-invoice-2026-09]]).

**Consumers:** Accountant. Some state (`showInvoiceModal`, `selectedInvoice`) shared with Payment Profiles tab's Last-Used link AND TimesheetUser's invoice view.

#### 6a. State + handler consumption map

| Kind | Name | Location | Also used by |
|---|---|---|---|
| useState | `accountantInvoiceFilter` (Set) — status pill | pre-role | Invoices only |
| useState | `invoiceMonthPreset` (Set) — month pill | pre-role | Invoices only |
| useState | `invoicePayOnPreset` (Set + 'none' sentinel) | pre-role | Invoices only |
| useState | `invoicePaymentMethodPreset` (Set + '' sentinel) | pre-role | Invoices only |
| useState | `invoiceSourceFilter` ('all' \| 'contractor' \| 'manual') | pre-role | Invoices only |
| useState | `invoiceDateRange`, `invoicePayDateRange`, `invoicePaidDateRange` (3× {start, end}) | pre-role | Invoices only |
| useState | `invoiceSelectedUsers` (nullable array, null = all) | pre-role | Invoices only |
| useState | `invoiceUserDropdownOpen`, `invoiceUserSearch` | pre-role | Invoices only |
| useState | `qbExportSnapshot` (frozen filter view), `qbExportSelectedIds` (Set) | pre-role | Invoices tab + QB Export modal |
| useState | `selectedInvoice`, `showInvoiceModal` | pre-role | **Cross-tab:** Invoices tab (primary) + Payment Profiles Last-Used + TimesheetUser view |
| Handler | `exportInvoicesCSV(filtered)` | pre-role | Invoices only |
| Handler | `openConveraBatchPreview(filtered)`, `openIntuitBatchPreview(filtered)` | pre-role | Invoices tab entry points |
| Handler | `paymentMethod(inv)`, `paymentMethodLabel(inv)`, `paymentMethodChipClass(inv)` | pre-role | **Cross-cutting** — chip renders in 3 render paths per [[payment-method-chip-render-paths]] |
| Handler | `reconcileInvoiceLive(inv, timesheets)` | pre-role | Invoices tab + likely InvoiceDetail modal |
| Handler | `loadConveraBeneficiaries`, `loadConveraLastPaymentDates` | pre-role | Invoices tab entry to Convera Matching + Payment Profiles Import Beneficiaries |
| Data | `invoices`, `paymentProfiles`, `timesheets`, `projects`, `users` | module scope | shared |
| Component | `StickyScrollWrapper` | inline at TS.tsx:9 (W1 target) | 4+ sites |
| Modal openers | `setShow{Manual,ConveraMatching,ConveraBatch,IntuitBatch,QbExport,Invoice}Modal` | pre-role | Invoices tab writes; modals render elsewhere |

#### 6b. Uniquely-owned surface (large)

1. **5 pill rows** (Month / Pay On / Payment Method / Source / Status) with varying styling — set-based multi-select, single-select, per-option colored active state, count badges, sentinel chips ("None", "Unassigned")
2. Multi-select **contractor dropdown** (nearly identical to Timesheet-Only's B2, 8309–8360)
3. **3 date-range inputs** (Period / Pay On / Paid On) side-by-side with clear buttons
4. **Batch action row** — 6 buttons (Manual Invoice, Convera Matching, CSV Export, Convera Batch, Intuit Batch, Export to QB)
5. **KPI cards** — 4-card grid with USD-only rollup + non-USD warning + contractor-vs-invoice count captions
6. **Grouped invoice mega-table** (13 columns):
   - Solo row rendering (`isGroup === false`)
   - Umbrella row rendering (`isGroup === true`) with aggregated header + expanded sub-rows for multi-contractor PDFs (e.g., Teal, Bimosoft)
   - `reconCell` inline fn — recon badge (Matched / Mismatch delta / No TS)
   - Sticky first column, sticky header, StickyScrollWrapper container
7. Row-click opens InvoiceDetail; Mark Paid + Re-approve inline actions
8. **QB Export pre-selection logic** (8398-8410): resolves live payment profile → checks `qbVendorName` + `qbExportStatus` → pre-selects ready invoices before opening modal

#### 6c. 🚨 Reusability lens findings

| Candidate | Sites | Rec |
|---|---|---|
| **B2 MultiSelectDropdown** | 4th accountant site (this contractor picker) | Reuse T1 (from Chunk 3). Confirms T1's value. |
| **B3 FilterPills** | 5 pill rows here, ~7+ total accountant sites | Reuse PP1 (from Chunk 5) — **needs `variant` extension** for: (a) per-option active color (payment method pills), (b) sentinel chips ("None" / "Unassigned"), (c) count-badge style. PP1's initial API may need adjustment. |
| **Recon badge** | Invoices tab row (8501-8528) + probably InvoiceDetail modal (need to verify) | If dual-consumer → extract to `src/components/InvoiceReconBadge.tsx`. |
| **`resolveLivePaymentProfile(inv, paymentProfiles)` helper** | Here (8401-8403) + likely InvoiceDetail + Convera Matching + Payment Import | 🎯 Extract to `src/lib/paymentProfileResolver.ts`. Small pure fn, 3+ callers. |
| **KPI card** | Weekly (4 cards) + Invoices (4 cards) + likely others | Optional `<KpiCard label value hint sub? />` primitive. Low urgency. |
| **Payment method chip** | 3 render paths per [[payment-method-chip-render-paths]] — solo row / group header / umbrella sub-row | Already flagged as trap in memory. Not new work here, but this chunk touches all 3. |

**Filter-pill variant challenge (design note):** the pills here range from binary multi-select with count to per-option colored active state to sentinel-value chips. A single `<FilterPills>` component with an `optionRenderer` prop is one path; two components (`<FilterPills>` for standard, `<VariantFilterPills>` for per-option color) is another. Consultant rec: **start with one component + `optionRenderer` prop**; split only if the customization gets awkward.

#### 6d. 🐛 Traps found

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T36 | 9+ filter states + 3 dropdown states + 2 QB-export snapshot states all at module scope but all Invoices-only. | Semantic scope violation of self-sufficient principle. | Move all inside `Invoices.tsx` on I6 extract, or (better) into a `useInvoiceFilters()` hook (I3). |
| T37 | `preStatusFiltered` / `prePayOnFiltered` / `filtered` chains recompute on every render. No memoization. With 500+ invoices, filter cascade takes measurable time. | Perf smell (measurable at scale). | `useMemo` in the new hook (I3). |
| T38 | Filter cascade is complex — `payOnDates` computed AFTER user/date/paid/month filters BUT BEFORE payOn filter. Nested comment references buried in 8138-8159. | Comprehension debt. | Extract to `useInvoiceFilters()` hook (I3) with named intermediate stages + inline docstrings. |
| T39 | Manual Invoice modal (`showManualInvoiceModal`) — component is already extracted at `src/components/manualInvoice/` per [[manual-invoice-2026-09]]. Just an entry-point in this tab. | None. | Note only. |
| T40 | `qbExportSnapshot` freezes the filter view when Export to QB is clicked, so filters can change while modal is open. Clever but non-obvious. | Semantics. | Preserve intent on extract. Consider comment. |
| T41 | Payment-profile resolution logic at 8401-8403 (`find by id → find by IBAN → find default`) is repeated in ~2-3 other places. | Duplication. | 🎯 Extract to `src/lib/paymentProfileResolver.ts` — Slice I5. |
| T42 | **Stale line reference** in code comment at 8306 references "line ~9767 displayGroups" — off by ~800 lines after Slices 1-5. | Reader confusion. | Fix on extract (delete stale line number, keep semantic explanation). |
| T43 | `openConveraBatchPreview(filtered)` and `openIntuitBatchPreview(filtered)` receive `filtered` at button-click time. Filter state can change between click and modal open (unlikely but async possible). | Latent. | Confirm modals also snapshot on open (like `qbExportSnapshot` does). |
| T44 | Reconciliation cell (`reconCell`, 8501-8528) inline as a nested function inside the outer IIFE — closes over `timesheets`, `reconcileInvoiceLive`. Runs on every render. | Cosmetic + perf. | Extract as a component or `useCallback` on I6 extract. |

#### 6e. Carve-out sequence

**Prerequisites:** PP1 (FilterPills), PP2 (AutocompletePicker — actually not needed here), T1 (MultiSelectDropdown from Chunk 3), W1 (StickyScrollWrapper) must land first.

**Slice I1 — Adopt B2 MultiSelectDropdown at contractor picker** *(depends: T1 shipped)*
- Swap 8309-8360 to `<MultiSelectDropdown options={invoiceUsers} selected={effectiveInvoiceUsers} onChange={setInvoiceSelectedUsers} placeholder="contractors" />`
- **Effort:** 30 min.

**Slice I2 — Adopt B3 FilterPills at 5 sites + extend variant API** *(depends: PP1 shipped, may require PP1 API extension)*
- Migrate 5 pill rows: Month, Pay On, Payment Method, Source, Status.
- Payment Method pills need per-option colored active state — extend PP1 with `optionRenderer` or `getActiveClass` prop.
- Sentinel chips ("None", "Unassigned") — either baked into option data or handled with a `renderExtra` slot.
- **Zero-regression check:** each pill row visually + functionally identical. Counts match. Colored active states preserved for Intuit vs Convera. Unassigned amber chip only shows when count > 0.
- **Effort:** ~2 hrs.

**Slice I3 — Extract `useInvoiceFilters()` hook** *(the semantic un-scattering — T36, T37, T38)*
- New file `src/hooks/useInvoiceFilters.ts`.
- Owns all 12 filter/dropdown state hooks.
- Exposes memoized: `invoiceMonths`, `invoiceUsers`, `prePayOnFiltered`, `preStatusFiltered`, `filtered`, `payOnDates`, `usdFiltered`, `nonUsdFiltered`, `totalFilteredUsd`, `nonUsdByCurrency`, `countCaption`.
- Exposes all setters as named handles.
- Snapshot tests locking output for representative fixtures.
- **Zero-regression check:** unit tests + Invoices tab loads with matching numbers.
- **Effort:** ~3-4 hrs. Biggest single slice in Chunk 6.

**Slice I4 — Extract `resolveLivePaymentProfile` helper** *(T41)*
- `src/lib/paymentProfileResolver.ts`.
- Swap here + 2-3 other sites (Convera Matching modal, Invoice Detail, Payment Import).
- **Effort:** 30-45 min. Independent slice.

**Slice I5 — Extract `<InvoiceReconBadge>`** *(optional — verify dual-consumer first)*
- Verify InvoiceDetail modal renders similar recon UI. If yes, extract to `src/components/InvoiceReconBadge.tsx` + swap.
- **Effort:** 30-45 min.

**Slice I6 — Extract Invoices tab to `src/roles/Accountant/tabs/Invoices.tsx`** *(self-sufficient tab, biggest of the chunk)*
- After I1-I3 land (I4/I5 optional), extract JSX + hook wiring.
- Props: `{ invoices, users, projects, timesheets, paymentProfiles, setSelectedInvoice, setShowInvoiceModal, setShowManualInvoiceModal, setShowConveraMatchingModal, setShowConveraBatchModal, setShowIntuitBatchModal, setShowQbExportModal, setQbExportSnapshot, setQbExportSelectedIds, exportInvoicesCSV, openConveraBatchPreview, openIntuitBatchPreview, loadConveraBeneficiaries, loadConveraLastPaymentDates, paymentMethod, paymentMethodLabel, paymentMethodChipClass, reconcileInvoiceLive }` — dense props but each is a real cross-tab dep.
- Tab-local via `useInvoiceFilters()` hook.
- Fix T42 (stale line comment), T44 (reconCell inline) during extract.
- **Zero-regression check:** every filter axis works, every KPI card matches, every modal opens correctly, every row action works, umbrella groups render correctly for Teal + Bimosoft + solo. Full manual smoke.
- **Effort:** ~3 hrs.

**Slice I7 — InvoiceDetail modal extraction** *(compound, dual-role — defer to Chunk 9 sweep OR do here)*
- InvoiceDetail at 13392 (accountant) + 15535 (TimesheetUser) — dual-owner.
- Extract to `src/components/InvoiceDetailModal.tsx` with `mode: 'accountant' | 'timesheetuser'`.
- **Behavior-locking tests mandatory** — 2 role modes.
- **Effort:** ~3 hrs.
- Consultant rec: **defer to Chunk 9**. Not blocking the Invoices tab extraction; Chunk 9 modals sweep is a natural home.

**Total Chunk 6 effort:** ~9-10 hrs across 5-6 slices (I7 deferred to Chunk 9). Biggest sequence dependency: PP1 + T1 must ship first.

#### 6f. Open questions

- **Q6.1** FilterPills API extension for variant color / sentinel chip — do we extend PP1 or introduce a second component? Consultant rec: **extend PP1 with `optionRenderer` and `renderExtra`** — same component, different shapes.
- **Q6.2** I7 InvoiceDetail extract — Chunk 6 or Chunk 9? Consultant rec: **Chunk 9** modal sweep.
- **Q6.3** T44 `reconCell` — extract as `<InvoiceReconBadge>` (slice I5) or keep inline? Depends whether InvoiceDetail also renders it. Verify.
- **Q6.4** `qbExportSnapshot` + `qbExportSelectedIds` — these serve QB Export modal. Where do they belong: tab-scope (feed props to modal) or modal-scope (modal owns its snapshot)? Consultant rec: **tab-scope** — the "freeze" pattern happens BEFORE modal opens, so tab is the right owner.

#### 6g. What this chunk does NOT touch

- The 6 modals themselves — all deferred to their own chunks (or Chunk 9 sweep).
- Convera pipeline handlers (`autoMatchBeneficiary` etc.) — Chunk 10.
- QB write pipeline — QB Automation chunk.
- Payment-method chip logic — the chip renders here in 3 paths per memory, but the logic (`paymentMethodLabel`, `paymentMethodChipClass`) already lives in pre-role and stays there for cross-consumer reasons.

**Confidence:** high on I1, I4, I5, I6. Medium on I2 (depends on PP1 API extension design). High on I3 (test coverage well-defined).

---

### Chunk 7 — Payments tab (TS.tsx 9088–9841, ~755 lines)

**Purpose in ops:** Convera transaction ledger. Import Convera XLS → batches of transactions → for each transaction: match to invoice(s), mark no_invoice, or leave flagged. Two-stage: staged edits (in-memory buffer) → Process modal → commit (marks invoices paid + updates umbrella links + advances batch state).

**Consumers in daily ops:** Accountant — heavy weekly use. Every batch of Convera wires goes through here.

**Pre-read summary (from memory):**
- [[convera-matcher-guardrails]] — SYN match requires IBAN corroboration; IBAN checksum at 3 layers; Short Name ASCII / Long Name raw. Fat Struct + TCode incidents.
- [[convera-retrofit-reality]] — 5 structural cliffs: 3-account bank split, umbrella N-per-1 fanout, fee allocation, UI-driven matching, Bimosoft UK ALT + live-profile fetch.
- [[umbrella-payment-patterns]], [[bimosoft-uk-alt]], [[qbxml-refnumber-collision]] — related invariants.

#### 7a. State + handler consumption map

| Kind | Name | Location | Also used by |
|---|---|---|---|
| useState | `paymentsStateFilter` (`'all'`\|`'unreviewed'`\|`'matched'`\|`'no_invoice'`\|`'flagged'`\|`'processed'`) | pre-role | Payments only |
| useState | `paymentsSortKey`, `paymentsSortDir` | pre-role | Payments only |
| useState | `selectedBatchId` (number \| 'all') | pre-role | Payments only |
| useState | `stagedMatches` (`Record<txnId, number[] \| 'no_invoice'>`) | pre-role | Payments only — **critical edit buffer** |
| useState | `showWiderForTxn` (`Record<txnId, boolean>`) | pre-role | Payments only |
| useState | `addInvoicePickerFor`, `addInvoicePickerSearch` | pre-role | Payments only |
| useState | `notesDrafts` (`Record<txnId, string>`) | pre-role | Payments only |
| useState | `showHistoricalTxns` | pre-role | Payments only |
| useState | `showProcessPreview`, `processCommitting` | pre-role | Payments only |
| useState | `paymentsImportFile`, `paymentsImporting`, `paymentsImportError`, `paymentsImportSummary`, `paymentsFileInputKey`, `paymentsProcessResult` | pre-role | Payments only (import UI) |
| useState | `paymentIifPreview`, `setPaymentIifPreview` | pre-role | Payments tab writes; preview modal renders in `<PaymentIifPreviewModal>` (already in audit as accountant modal M5) |
| Handler | `handlePaymentsImport` (~4903) | Convera pipeline | Payments only |
| Handler | `handleReopenBatch`, `handleRollbackBatch` | Convera pipeline | Payments only |
| Handler | `handleProcess` (~5252) | Convera pipeline | Payments only — **critical: marks invoices paid + upserts convera_transaction_billpmts + advances batch state** |
| Handler | `buildPaymentIifPreview(batchId)` | pre-role | Payments only |
| Handler | `autoMatchBeneficiary`, `resolveBeneficiary`, `matchPaymentGroup`, `matchPaymentToInvoice`, `applyConveraPayments` | Convera pipeline (3300-5700) | Payments tab + Import beneficiaries + auto-match on import |
| Data | `converaTransactions`, `importBatches`, `paymentProfiles`, `invoices`, `users`, `timesheets` | module scope | shared |
| Cross-modal | `setConveraTab('intuitXlsx') + setShowConveraModal(true)` at 9251 | | Opens PaymentImport modal to Intuit XLSX tab — T51 (aligned with Slice M0) |

#### 7b. Uniquely-owned surface

1. **Header** — 2 import buttons (Convera XLS, Intuit Payments XLS cross-modal)
2. **Import preview + Import button + error banner**
3. **Post-import summary panel** — 4-way (new / refresh / skip / amount-changed)
4. **Post-process summary panel** — 3-way (matched / no_invoice / batch-fully-processed)
5. **Batch selector** — pills per batch + "All" + Historical toggle (`matcher_ignore` rows, pre-2026-06-20)
6. **Batch action bar** (when single batch selected) — Reopen / Accept auto-matches / Rollback / Export Payments IIF
7. **State filter pills** — grouped by lifecycle (Pending / Processed / Issues) with column dividers
8. **Transaction table** (7 columns) — critical rendering:
   - **Match cell** (~150 lines nested inside row map): chip stack, delta indicator ($ selected vs $ payment with $50 fee tolerance), "+Add invoice" dropdown with search + wider-matches toggle, No-invoice button
   - **Notes textarea** with save-on-blur draft
   - Confidence pill, State pill
9. **Sticky bottom bar** — staged-change count + Discard + Process
10. **Process preview modal** (9750-9838) — 3-stat header + already-paid warnings + match list + Confirm button

#### 7c. 🚨 Reusability lens findings

| Candidate | Sites | Rec |
|---|---|---|
| **B3 FilterPills** (state filter pills, grouped variant) | Payments here — grouped with dividers + section labels. Other tabs: flat. | Extend PP1 (Chunk 5) with **`renderGroups?` variant** for section labels + dividers. Payments is the outlier that pushes the design. |
| **B3 FilterPills** (batch pills, 9333-9345) | Payments here + no cross-consumers | Standard PP1 usage. |
| **B4 SortableHeader** (`toggleSort` + `sortArrow` inline at 9221-9226) | Payments + Client Estimation + Invoices doesn't use + Missing QB Bills + Beneficiaries + Admin allocations (6+) | Extract to `src/components/SortableHeader.tsx` — Chunk 9 sweep. |
| **File-upload card** (9260-9268 preview + Import button + error) | Payments Convera import + Beneficiary import + Client Estimation "Import corrected" | Small `<FileUploadCard>` primitive — 3 callers. Chunk 9. |
| **Post-op summary banner** (9272-9328 two variants) | Payments only currently | Skip — one caller. |
| **`useStagedEdits()` hook pattern** (edit buffer → sticky action bar → preview modal → commit) | Payments only. | Local hook `usePaymentsStaging()`; not cross-role. |

**Convera pipeline handlers (`handlePaymentsImport`, `handleProcess`, etc.) do NOT extract here** — they're Chunk 10's job. Payments tab consumes them via props post-extraction.

#### 7d. 🐛 Traps found

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T45 | 15+ state hooks all Payments-only, at module scope. Same self-sufficient violation as Invoices. | Semantic. | Move inside `usePaymentsUI()` hook (PL1). |
| T46 | `stagedMatches: Record<txnId, number[] \| 'no_invoice'>` — critical edit buffer with no type alias. Undefined = "unchanged from DB". | Type-safety, comprehension. | Alias + wrap in `useStagedMatches()` with named ops (`stage`, `unstage`, `setNoInvoice`, `clearAll`). |
| T47 | Match cell logic (~150 lines) is nested inside table row map. Any change requires scrolling through 200 lines of context. | Comprehension + testability. | Extract `<PaymentMatchCell>` component (PL2). |
| T48 | `effStateOf(t)` and `effectiveMatch(t)` and the render's per-row derivation each restate the "staged wins over DB" rule. | Duplication. | Single derivation via hook. |
| T49 | `candidatesFor(t)` closes over `paymentProfiles`, `invoices`, `claimedByOther`. Recomputed for every row on every render. | Perf. | Memoize via `useMemo` keyed on `[converaTransactions, invoices, paymentProfiles]`. Return `Map<txnId, {same, wider}>`. |
| T50 | Notes textarea save-on-blur has no debounce/optimistic UI. Slow-network double-tab could double-fire. | Minor. | Track in-flight requests per row. |
| T51 | `setConveraTab('intuitXlsx'); setShowConveraModal(true)` at 9251 — same PP-tab pattern (T28). String-tag switch. | Coupling. | Aligned with Slice M0 (Chunk 9 modals sweep). |
| T52 | `paymentIifPreview` state opened here; modal renders elsewhere (M5 `<PaymentIifPreviewModal>`). Cross-tab state — legitimate. | None; note. | Preserve pattern; when M5 extracts, pass `paymentIifPreview + setPaymentIifPreview` as props. |
| T53 | `handleProcess` is critical (marks invoices paid + updates `convera_transaction_billpmts` + advances batch state). Currently in Convera pipeline pre-role. **Zero test coverage today.** | **Highest-risk trap in the arc.** | Chunk 10 must ship behavior-locking tests BEFORE extracting `handleProcess`. |
| T54 | `buildPaymentIifPreview(b.id)` composes IIF with 3-account Key Point→WU→A/P split. Per [[convera-retrofit-reality]] this is Convera-specific with no qbXML equivalent yet. | Retrofit gap, not a bug. | Chunk 10 design question: keep IIF-only or design qbXML pipeline. Consultant rec: **keep IIF for Convera-write path** — retrofit is a separate roadmap item. |
| T55 | Fee tolerance = $50 (hard-coded at 9511). Per [[convera-retrofit-reality]] fee allocation is bespoke — proportional vs single-line vs other. This constant reflects the loosest tolerance; not aligned with any explicit business rule. | Latent — might miss wire-fee anomalies. | Verify with Dan whether $50 is intended or drifted. Add code comment. |

#### 7e. Carve-out sequence

**Prerequisites:** PP1 (FilterPills — with grouped variant extension for state pills), PP2 (AutocompletePicker), T1 (MultiSelectDropdown), W1 (StickyScrollWrapper) landed.

**Slice PL1 — Extract `usePaymentsUI()` hook** *(un-scattering — T45, T48, T49)*
- New file `src/roles/Accountant/tabs/Payments/usePaymentsUI.ts`.
- Owns all 15 Payments-only state hooks.
- Exposes memoized: `rows`, `sortedRows`, `stateCounts`, `stagedChangeCount`, `candidatesByTxn` (Map).
- Exposes derivation fns: `effStateOf`, `effectiveMatch`, `contractorsFor`, `isEditable`, `toggleSort`, `sortArrow`.
- Exposes staged-edit ops: `stage(txnId, ids)`, `unstage(txnId)`, `setNoInvoice(txnId)`, `discardAll()`.
- **Effort:** ~3-4 hrs. Behavior-locking not needed (pure state ops), but manual smoke on filter counts + candidate lists.

**Slice PL2 — Extract `<PaymentMatchCell>` component** *(T47)*
- New file `src/roles/Accountant/tabs/Payments/PaymentMatchCell.tsx` (~200 lines).
- Encapsulates: chip stack, delta indicator, +Add dropdown w/ search + wider toggle, No-invoice button, undo.
- Props derived from `usePaymentsUI()` — accept `stagedMatches`, `candidates`, `editable`, `onStage`, etc.
- **Effort:** ~2 hrs.

**Slice PL3 — Adopt shared atoms**
- FilterPills (PP1): state pills row (with grouped variant — needs PP1 extension), batch pills row
- SortableHeader (Chunk 9 — defer if not yet extracted)
- FileUploadCard (deferred: extract in Chunk 9 if 3+ callers confirmed)
- **Effort:** 90 min (partial — depends on Chunk 9 timing).

**Slice PL4 — Extract `<ProcessPreviewModal>` component**
- New file `src/roles/Accountant/tabs/Payments/ProcessPreviewModal.tsx`.
- Props: `{ open, onClose, stagedMatches, converaTransactions, invoices, onProcess, processCommitting }`.
- **Zero-regression check:** manual — stage a few matches, click Process, verify stats + already-paid warnings + match list all identical.
- **Effort:** 90 min.

**Slice PL5 — Extract `<PostImportSummary>` + `<PostProcessSummary>` panels**
- Two small dumb-render components. Optional. Cosmetic modularization.
- **Effort:** 45 min. Defer if timeline pressure.

**Slice PL6 — Extract Payments tab to `src/roles/Accountant/tabs/Payments/index.tsx`** *(self-sufficient tab)*
- Directory (not single file) because tab + PaymentMatchCell + ProcessPreviewModal + Summary panels.
- Props: `{ converaTransactions, importBatches, invoices, paymentProfiles, users, timesheets, setConveraTransactions, setShowConveraModal, setConveraTab, setPaymentIifPreview, handlePaymentsImport, handleReopenBatch, handleRollbackBatch, handleProcess, buildPaymentIifPreview, paymentMethod }` — dense but each is a real cross-tab dep.
- **Tab-local via `usePaymentsUI()`.**
- **Zero-regression check (extensive — this is where accountant does real weekly ops):**
  1. Batch selector: switch batches, All view, Historical toggle
  2. State filter pills: each pill filters correctly + counts match
  3. Sort headers: date/beneficiary/amount/confidence, asc/desc
  4. Import Convera XLS: file picker → preview → Import → post-import summary shows correctly
  5. Import Intuit Payments XLS: opens the PaymentImport modal to correct tab
  6. Per-row: stage a match (chip appears + ring), unstage (chip removed), No invoice (row grays), Undo works
  7. + Add invoice dropdown: search filters, wider toggle shows/hides wider matches, click adds to staged
  8. Delta indicator: shows correct $ selected vs $ payment, fee tolerance green/amber
  9. Notes textarea: type, blur, verify persistence, no double-save
  10. Sticky bottom bar: staged count updates, Discard clears, Process opens preview
  11. Process preview: stats correct, already-paid warnings shown for paid invoices in staged matches, Confirm commits
  12. Post-process summary: shown after commit
  13. Batch actions (single batch selected): Reopen, Accept auto-matches (with count), Rollback confirms, Export Payments IIF opens preview modal
- **Effort:** ~3-4 hrs (careful smoke test — critical daily-use surface).

**Slice PL7 (linked to Chunk 10) — Convera handler extraction**
- Cross-referenced with Chunk 10. Includes behavior-locking tests BEFORE moving `handleProcess` + siblings.
- Not executed in Chunk 7 — flagged as dependency.

**Total Chunk 7 effort:** ~11-13 hrs across 5-6 slices (PL5 optional). Actual Convera pipeline handlers stay in place until Chunk 10.

#### 7f. Open questions

- **Q7.1** PP1 FilterPills — extend with `renderGroups` variant (grouped with dividers + section labels) or accept that Payments has its own inline grouped pills? Consultant rec: **extend PP1** — reusability principle.
- **Q7.2** T55 fee tolerance $50 constant — is this an intended business rule or drift? If intended, add code comment. If drifted, revisit with per-vendor tolerance.
- **Q7.3** `usePaymentsUI()` scope — one big hook, or split into `usePaymentsFilters()` + `usePaymentsStaging()` + `useCandidatesFor()`? Consultant rec: **split into 3** — smaller hooks, testable independently.
- **Q7.4** PL4 ProcessPreviewModal — extract during PL sequence or defer to Chunk 9 modals sweep? Consultant rec: **during PL sequence** — it's tightly coupled to Payments; not a cross-role modal.
- **Q7.5** T51/PaymentImport modal split (Slice M0) — schedule in Chunk 9 sweep. Confirmed.

#### 7g. What this chunk does NOT touch

- The Convera pipeline handlers themselves (Chunk 10).
- `<PaymentImport>` modal (Slice M0 in modularization-audit — Chunk 9 sweep).
- `<PaymentIifPreviewModal>` (accountant modal M5 — Chunk 9 sweep).
- `<ConveraMatchingModal>` (accountant modal — Chunk 9 sweep).
- Invoice payment-marking logic (handled by `handleProcess`, stays in Convera pipeline).
- Fee-allocation redesign (retrofit — long-term roadmap per [[convera-retrofit-reality]]).

**Confidence:** high on PL1, PL2, PL4, PL6. Medium on PL3 (depends on PP1 grouped-variant extension). PL7 gated on Chunk 10 tests.

---

### Chunk 8 — QB Automation tab (TS.tsx 9843–11560, ~1,717 lines)

> **🛑 STOP GATE (2026-09-17):** Dan wants to discuss the QB Automation tab with Claude BEFORE any Chunk 8 slice (X4, QA7, QA8, QA9) starts. The conversation may reshape the tab and change X4's API boundary. Execution must pause + prompt for the discussion when the arc reaches X4 (immediately after IB in Phase 4). See §1b-C for the same gate as an executor-level rule.

**Purpose in ops:** The command center for the QB Automation Layer. Reads `qb_ingest_events`, classifies + groups + previews + pushes to QuickBooks. Central surface for the 4-layer architecture ([[qb-automation-architecture]]) — this tab is the UI over qb_mirror + qbStateSync + qbWrite. Multi-section with a locked UX contract.

**Consumers:** Accountant — **daily**, sometimes multiple times a day. Highest-visibility tab in the app.

**Pre-read summary (from memory):**
- [[qb-automation-ux-contract]] — 6 IMMUTABLE rules. Locked 2026-08-26 after G7.5 UI drift. Any change to this tab MUST honor them.
- [[qb-automation-architecture]] — 4-layer model (qb_mirror READ · qbStateSync · source adapters · qbWrite EXECUTOR). Locked 2026-08-20.
- [[qbwrite-invariants]] — 36 rules the executor enforces.
- [[intuit-qb-layer-spec]] — v3 spec with 8 cases across Intuit×Convera.

#### 8a. State + handler consumption map — LARGE

**State hooks (20+ QB-scoped useState — all at module scope today):**

| Group | Names | Cross-consumed? |
|---|---|---|
| Inline edit | `qbVendorEditingId`, `qbVendorEditValue` | ⚠ **Also PP tab** (Chunk 5 T32). |
| QB Export | `qbExportSelectedIds`, `qbExportSnapshot`, `qbExportCategoryFilter` | Written from Invoices tab (Chunk 6). |
| Inbox data | `qbIngestEvents`, `qbG75PostedInvoiceIds`, `qbG76PostedInvoiceIds`, `qbIngestLoading` | QB Auto only |
| Expand/collapse | `qbInboxExpanded` (Record<string, boolean>) | QB Auto only — multi-purpose (sections + months + missing_bills) |
| In Progress | `qbPushRecords` | QB Auto only |
| Mirror | `qbOpenBills` | QB Auto only |
| QBWC sync | `qbSyncingBills`, `qbBillQueryPending`, `qbPendingJobDetails`, `qbSyncingVendors`, `qbVendorQueryPending`, `qbWcLastSeen` | QB Auto only |
| Catalog | `qbVendorsList`, `qbAccountsList`, `qbVendorMappings` | Referenced from Payment Profiles for `qbVendorSuggestions` autocomplete |
| Modals | `showQbPushPreview`, `mapVendorOpenFor`, `mapForm`, `showPendingJobsPopup` | QB Auto only |
| Sort | `missingBillsSortKey`, `missingBillsSortDir`, `postedSortKey`, `postedSortDir` | QB Auto only |
| Reconcile helpers | `recomputeBusy`, `converaBillPmtCandidates`, `converaAllBillsExist` | QB Auto only |

**Handlers used:**
- Data loaders: `loadQbIngestEvents`, `loadQbOpenBills`, `loadQbWcLastSeen`, `loadQbVendorMappings`, `loadQbVendorsAndAccounts`, `runRecomputeButton`
- Sync enqueue: `runSyncQbBills`, `runSyncQbVendors`
- Push orchestration: `pushConveraCreateBillAndPay(supabase, ids)` + related per-source pushers
- Mapping CRUD: `saveQbVendorMapping`, `deleteQbVendorMapping`
- Cross-tab: `saveQbVendorName` (Chunk 5 T32)
- Helpers: `snapshotAge`, `humanizeAge`, `sourceLabel(s)`, `applyClassificationPass`, `applyReconciliationPass`

**Cross-role components (already extracted ✅):**
- `<QbPushPreviewModal>`, `<QbPushStatusPane>`, `<VendorDecisionModal>`

#### 8b. Section structure (11 distinct render blocks)

| # | Section | Approx lines | Notes |
|---|---|---|---|
| 1 | Header | ~110 (10130-10237) | Title + Recompute + Refresh + Push button + freshness + QBWC heartbeat + sync state |
| 2 | `<QbPushStatusPane>` (In Progress) | 5 (10238-10242) | Cross-role component ✅ |
| 3 | Mapping widget modal | ~250 (10246-10496) | Opens on `mapVendorOpenFor` |
| 4 | All Vendor Mappings panel | ~230 (~525-755) | Collapsible management table |
| 5 | `<QbPushPreviewModal>` render | ~15 (~596-611) | Cross-role component ✅, opens on `showQbPushPreview` |
| 6 | Push result modal | ~35 (~1001-1038 relative) | Inline |
| 7 | Pending jobs popup | ~60 (~1039-1097 relative) | Inline |
| 8 | Needs Vendor Decision panel | ~100 (~1099-1200 relative) | Approved invoices lacking mapping → opens `<VendorDecisionModal>` ✅ |
| 9 | Missing QB Bills panel | ~160 (~1203-1358 relative) | Amber-styled table, sortable |
| 10 | Inbox groups (Needs Classification / Check / Already Done / etc.) | ~500 (11151-~1570 relative) | Multi-group render |
| 11 | Already Posted section (nested under groups map) | ~200 within groups | Month-rolled per UX rule 5, sortable per UX rule 6 |

#### 8c. 🚨 Reusability lens findings

| Candidate | Sites | Rec |
|---|---|---|
| **B4 SortableHeader** | 3+ in QB Auto alone (Missing QB Bills, Already Posted, likely Vendor Mappings) + Client Estimation + Payments = 5+ | Chunk 9 sweep — **essential prereq**. |
| **B5 AutocompletePicker** (Vendor name inline edit) | 4+ per audit — PP tab (Chunk 5 T32) + Mapping widget here + QB Export modal + Convera Matching | Reuse PP2 (Chunk 5). |
| **QBWC heartbeat / freshness derived state** | Only here | Extract as `useQbSyncState()` hook — testable, cleaner tab. |
| **Missing QB Bills computation** | Only here — but complex + business-critical (cutoffs, payment path, mirror check) | Extract as pure fn `computeMissingBills()` to `src/lib/qbAutomation/`. Test-lockable. |
| **Inbox group builder** | Only here — but complex classifier | Extract as pure fn `computeQbInboxGroups()`. |
| **Posted event row renderer** | Only here — 140+ lines with badge helpers, provenance cell, resolvedAction switch | Extract as `<PostedEventRow>` component. |
| **Push result modal** + **Pending jobs popup** | Inline in this tab only | Extract as small display components. |
| **Mapping modal** | Only here | Extract to `src/roles/Accountant/tabs/QbAutomation/MappingModal.tsx`. |

#### 8d. 🐛 Traps found

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T56 | 20+ QB-scoped useState hooks at module scope. Most tab-local; some cross-consumed (`qbVendorEditingId`+value with PP tab; `qbExportSnapshot` with Invoices tab). | Self-sufficient violation. | `useQbAutomation()` hook for tab-local; keep cross-consumers at wrapper. |
| T57 | `qbInboxExpanded: Record<string, boolean>` — polyglot state (sections + month keys `posted_month_2026-08` + `missing_bills`). Semantics buried in usage. | Comprehension. | Split into `sectionExpanded`, `monthExpanded`, `panelExpanded` on extract. |
| T58 | Inbox `groups[]` constructed inline (11151+) with 5+ filter chains. Complex classifier logic. Zero tests. | Test gap, comprehension. | Extract pure `computeQbInboxGroups()` → `src/lib/qbAutomation/inboxGroups.ts` + tests. |
| T59 | Header freshness + heartbeat logic (~80 lines inline at 10150-10234). Derives 10+ vars, colors, labels. | Comprehension. | Extract `useQbSyncState()` hook. |
| T60 | Missing QB Bills computation (~168 lines inline at 9853-10121). Cutoff logic + path resolution + mirror check. Business-critical. **Zero test coverage.** | Test gap. | Extract pure `computeMissingBills()` → `src/lib/qbAutomation/missingBills.ts` + tests. |
| T61 | Posted section month-rolling logic (11154-11185) inline. Multiple helpers. | Comprehension. | Encapsulate in `<AlreadyPostedSection>` component. |
| T62 | `renderPostedRow` inline (~140 lines starting 11233). Badge helpers, provenance cell, resolvedAction switch. | Comprehension + perf. | Extract `<PostedEventRow>` component. |
| T63 | Push to QB flow — button → selection → per-source dispatcher (`pushConveraCreateBillAndPay` + others). Orchestration logic embedded in click handler. | Comprehension. | Extract `pushQbEvents()` orchestrator in `src/lib/qbAutomation/pushOrchestrator.ts`. |
| T64 | Two vendor-mapping surfaces: Mapping widget (modal) + All Vendor Mappings panel (inline management). Both edit same table. UX consistency uncertain. | UX drift risk. | Verify same edit flow post-extract; consolidate if drift found. |
| T65 | `converaBillPmtCandidates` + `converaAllBillsExist` — inline reconciliation helpers derived from events + mirror. Complex logic passed to `pushConveraCreateBillAndPay`. | Comprehension. | Encapsulate derivation in `useQbAutomation()`. |
| T66 | Push result modal + Pending jobs popup inline (~100 combined lines). | Modularization. | Extract as `<PushResultModal>` + `<PendingJobsPopup>`. |
| T67 | `mapVendorOpenFor` + `mapForm` coupled: modal opens when `mapVendorOpenFor != null`, reads `mapForm`. Reset must clear both. | Coupling. | Encapsulate in `MappingModal`'s own state. |
| T68 | **[[qb-automation-ux-contract]] 6 rules are UNTESTED.** Any refactor could silently violate rule 1 (counter refresh) or rule 5 (Already Posted month grouping ≠ dropdown filter). | Regression risk. | 🎯 **Snapshot tests locking UX shape BEFORE tab extract (QA8).** |
| T69 | `qbVendorMappings` cache re-loaded after every push (`loadQbVendorMappings()` in refresh set at 10139). Correct but under-documented. | Cosmetic. | Comment on extract. |
| T70 | Some sections use `expanded ? '▼' : '▶'` chevrons, others use `sortChevron` with `▲/▼`. Slight inconsistency. | UX rule 3 violation (mild). | Standardize on extract. |

#### 8e. Carve-out sequence

**Prerequisites (must land before QA9):** PP2 (AutocompletePicker), Chunk 9 B4 SortableHeader.

**Slice QA1 — Extract `computeMissingBills()` pure fn** *(T60 — business-critical)*
- New file `src/lib/qbAutomation/missingBills.ts`.
- Signature: `(inputs: { invoices, paymentProfiles, qbOpenBills, qbVendorMappings, cutoffs }) => MissingBill[]`.
- Unit tests for: pre-cutoff exclusion, unmapped vendor detection, Bill-in-mirror check (by ref+month), payment-path resolution.
- **Effort:** ~3 hrs.

**Slice QA2 — Extract `computeQbInboxGroups()` pure fn** *(T58)*
- `src/lib/qbAutomation/inboxGroups.ts`.
- Tests for: classification by `targetQbTxnKind`, `resolvedAction`, exclusion of `pre-our-system` events, group ordering.
- **Effort:** ~2 hrs.

**Slice QA3 — Extract `useQbSyncState()` hook** *(T59)*
- `src/roles/Accountant/tabs/QbAutomation/hooks/useQbSyncState.ts` (module-scope hook).
- Inputs: `{ qbWcLastSeen, qbBillQueryPending, qbVendorQueryPending, qbSyncingBills, qbSyncingVendors, qbOpenBills, qbPendingJobDetails }`.
- Outputs: `{ snapshotLabel, snapshotStale, qbwcLabel, qbwcColor, qbwcAlive, qbwcDown, nextPollLabel, syncPending, syncLabel, vendorSyncPending, vendorSyncDisabled, vendorSyncLabel }`.
- **Effort:** ~90 min.

**Slice QA4 — Extract Mapping Modal** *(T64 partial, T67)*
- `src/roles/Accountant/tabs/QbAutomation/MappingModal.tsx`.
- Owns `mapVendorOpenFor` + `mapForm` state internally (uncontrolled) OR receives from parent (controlled). Consultant rec: **controlled**, parent still owns open-state (matches existing pattern).
- Uses PP2 AutocompletePicker for vendor search.
- **Effort:** ~90 min.

**Slice QA5 — Extract PushResultModal + PendingJobsPopup** *(T66)*
- Two small display components under `src/roles/Accountant/tabs/QbAutomation/`.
- **Effort:** ~60 min.

**Slice QA6 — Extract PostedEventRow component + AlreadyPostedSection** *(T61, T62)*
- `<PostedEventRow>` — badge helpers, provenance cell, resolvedAction switch.
- `<AlreadyPostedSection>` — month rollup + expand/collapse.
- **Effort:** ~2 hrs.

**Slice QA7 — Extract `useQbAutomation()` hook** *(T56, T57 partial, T65)*
- `src/roles/Accountant/tabs/QbAutomation/hooks/useQbAutomation.ts`.
- Owns all tab-local QB useState hooks (excludes cross-consumers `qbVendorEditingId+value` and `qbExport*`).
- Composes: `useQbSyncState()`, memoized `groups` (via QA2), memoized `missingBills` (via QA1), `converaBillPmtCandidates`/`converaAllBillsExist` derivations.
- Splits `qbInboxExpanded` into `sectionExpanded`, `monthExpanded`, `panelExpanded` (T57).
- **Effort:** ~3-4 hrs.

**Slice QA8 — UX contract snapshot tests** *(T68)* — **PREREQUISITE FOR QA9**
- Playwright or React Testing Library.
- Lock: pending counter is present + reflects push count · In Progress pane exists · all sections have same header shape · Already Posted uses month rollup NOT dropdown filter · all columns sortable · row density consistent.
- Tests must fail if UX contract violated.
- **Effort:** ~3 hrs.

**Slice QA9 — Extract QB Automation tab to `src/roles/Accountant/tabs/QbAutomation/index.tsx`** *(self-sufficient tab, live daily, UX contract)*
- Directory structure:
  ```
  src/roles/Accountant/tabs/QbAutomation/
    index.tsx                      # main tab
    MappingModal.tsx               # QA4
    PostedEventRow.tsx             # QA6
    AlreadyPostedSection.tsx       # QA6
    PushResultModal.tsx            # QA5
    PendingJobsPopup.tsx           # QA5
    NeedsVendorDecisionPanel.tsx   # extract with tab
    MissingBillsPanel.tsx          # extract with tab
    AllVendorMappingsPanel.tsx     # extract with tab
    Header.tsx                     # freshness + heartbeat UI
    hooks/
      useQbAutomation.ts           # QA7
      useQbSyncState.ts            # QA3
  ```
- Props: `{ invoices, paymentProfiles, users, timesheets, supabase, qbVendorEditingId, qbVendorEditValue, setQbVendorEditingId, setQbVendorEditValue, saveQbVendorName, applyClassificationPass, applyReconciliationPass, pushConveraCreateBillAndPay, ... }` — dense but each is a real dep.
- Tab-local everything else via `useQbAutomation()`.
- **Zero-regression check:** QA8 snapshot tests + extensive manual smoke:
  1. Header counters + freshness + QBWC heartbeat all update correctly
  2. Sync buttons work, pending state shown
  3. Recompute + Refresh + Push to QB flow works end-to-end
  4. All 11 sections render + expand/collapse
  5. Mapping widget open + save + delete
  6. All Vendor Mappings panel edits
  7. Missing QB Bills sort by every column
  8. Already Posted month rollup (current month expanded, older collapsed)
  9. Already Posted sort by every column
  10. In Progress pane shows active pushes
  11. Push result modal + Pending jobs popup work
  12. UX contract rules 1-6 all honored (compare to pre-extract screenshots)
- **Effort:** ~3-4 hrs.

**Total Chunk 8 effort:** ~18-20 hrs across 9 slices. Biggest chunk in the arc.

#### 8f. Open questions

- **Q8.1** Mapping Modal (QA4) — controlled or uncontrolled state? Consultant rec: **controlled**, matches existing pattern.
- **Q8.2** UX contract snapshot tests (QA8) — Playwright (E2E) or RTL (unit)? Consultant rec: **RTL** for the shape assertions, add 1 Playwright smoke for the end-to-end push flow.
- **Q8.3** T64 — two vendor-mapping surfaces. Consolidate to one after QA4/QA7 (both surfaces open the same MappingModal), OR keep the inline management panel as a bulk-view? Consultant rec: **keep both — Mapping widget = per-row edit, All Vendor Mappings = bulk-view.** They serve different UX needs; unifying flattens the UX.
- **Q8.4** `qbInboxExpanded` T57 split — do it during QA7 (with data schema migration for the localStorage-persisted state, if any), or hold? Consultant rec: **do during QA7** — cleaner boundary.
- **Q8.5** Push orchestrator T63 — extract to `src/lib/qbAutomation/pushOrchestrator.ts`, or leave as a QA7 hook method? Consultant rec: **pure fn in lib** — pushOrchestrator has side effects (`supabase` calls) but the "which events → which handler" mapping is pure and testable.

#### 8g. What this chunk does NOT touch

- The 4-layer QB architecture (`qb_mirror`, `qbStateSync`, source adapters, `qbWrite`) — that's a **separate arc** from this modularization; the tab is the UI over it.
- Cross-role modals already extracted (`<QbPushPreviewModal>`, `<QbPushStatusPane>`, `<VendorDecisionModal>`).
- Convera pipeline handlers (Chunk 10).
- `<InvoiceDetail>` modal (Chunk 9 sweep).

**Confidence:** high on QA1-QA6. Medium-high on QA7. QA8 is a HARD prerequisite for QA9 (do not extract the tab without UX contract snapshot tests in place). QA9 confidence high given the test scaffolding.

---

### Chunk 9 — Modals sweep + shared-atom sequencing

**Purpose:** Consolidate the shared-atom + modal extraction slices scattered across Chunks 1–8 into a single global sequence. Identifies which atoms are dependencies of which tab extracts, and orders them so nothing blocks anything.

**No new tab analysis here.** This is the sequencing chunk — the "how do all the earlier extraction slices interlock" chunk.

#### 9a. Shared-atom rollup (across all chunks)

| Atom | Slice ID | Callers today | Depends on | Blocks | Effort |
|---|---|---|---|---|---|
| **StickyScrollWrapper** | W1 | 4 (Auth, Weekly, TS-Only, Invoices) | — | W3, T4, I6 | 20-30 min |
| **SourceBadge** *(Portal/Email pill)* | T2 | Weekly + TS-Only + likely more (Consolidated table?) | — | W3, T4, C5 | 30 min |
| **MultiSelectDropdown** | T1 | 4 accountant sites — TS-Only, Invoice contractor picker, Convera Matching, Payment Import unmatched | — | T4, I1 | ~2 hrs |
| **FilterPills** (base) | PP1 | 7+ sites — PP tab (4 chips), Invoices (5 pill rows), Payments (grouped state + batch pills), Beneficiary filter, QB Automation | — | PP4, I2, PL3 | ~90 min |
| **FilterPills variant extensions** | PP1-ext | Invoices (colored per-option Intuit/Convera + sentinel "Unassigned" chip), Payments (grouped with dividers + section labels) | PP1 base | I2, PL3 | ~2 hrs (design + retro-fit) |
| **AutocompletePicker** *(vendor edit)* | PP2 | 4+ sites — PP tab, QB Automation MappingModal, QB Export modal, Convera Matching, Payment Import unmatched | — | PP4, QA4, QA9 | ~90 min |
| **StatusBadge** *(A10)* | A10 | ~15 sites | — | Weekly, TS-Only, Invoices, everywhere | ~1 hr |
| **SortableHeader** *(B4)* | B4 | 5+ sites — Client Est, Payments, Missing QB Bills, Already Posted, Beneficiaries | — | CEP2 (partial), PL1, QA6, QA9 | ~2 hrs |
| **CopyChip** *(B6)* | B6 | 3 sites — Convera Batch modal, Intuit Batch modal, Convera Matching modal | — | Modal extractions below | ~1 hr |
| **FileUploadCard** | (new) | 3 sites — Payments Convera XLS import, Beneficiary import, Client Est "Import corrected" | — | CEP2, PL6, PaymentImport modal | ~90 min |
| **KpiCard** | (new, optional) | 2 sites — Weekly + Invoices | — | (deferred) | ~45 min |
| **CountryRegionSelect** *(A11)* | A11 | 4 sites — Admin User modal, TimesheetUser profile completion, VM profile, PaymentProfileModal | — | PP3, later Admin extract | ~1.5 hrs |
| **PasswordChangeForm** *(A9)* | A9 | 3 sites — TimesheetUser profile tab + Set Password screen + (VM used to have inline, now VM is extracted with drilled state) | — | TimesheetUser extract (later) | ~1 hr |
| **PaymentProfileModal** *(A6)* | PP3 | 3 sites (cross-role) — Accountant + VM (currently prop-drilled) + TimesheetUser invoice-create | PP2 (AutocompletePicker for QB vendor field), A11 (CountryRegionSelect) | PP4 | ~3 hrs (compound, mandatory tests) |
| **InvoiceDetailModal** | I7 | 2 sites (dual-role) — Accountant Invoices + TimesheetUser Invoices | (independent) | PP4 (Last-Used link), I6 (row click) | ~3 hrs (mandatory tests) |
| **PaymentImport modal split** *(Slice M0)* | M0 | Split into 2 — `ImportIntuitPaymentsXlsx` + `ImportConveraBeneficiaries` | FileUploadCard (partial), MultiSelectDropdown (unmatched picker) | Payments PL6, PP tab PP4 | ~4 hrs (deletion pass shipped, spec frozen in modularization-audit.md) |
| **`resolveLivePaymentProfile()`** | I4 | 3+ sites — Invoices tab, Convera Matching, Payment Import unmatched | — | I6 | 30-45 min |
| **`<InvoiceReconBadge>`** | I5 | 2 sites (verify) — Invoices tab + InvoiceDetail modal | — | I6, I7 | 30-45 min (optional) |

#### 9b. Accountant-owned modal rollup

Excluding modals already extracted (QbPushPreview, QbPushStatus, VendorDecision, TimesheetDetail, ManualInvoice) and tab-local modals (MappingModal→QA4, PushResult+PendingJobs→QA5, ProcessPreview→PL4, ClientInvoice→CEP2, Import preview→CEP2).

| Modal | Current location | Consumers | New home | Depends on | Effort |
|---|---|---|---|---|---|
| **TemplateProfile** | inline 11772 | PP tab (`openTemplateProfileModal(userId)`) | `src/roles/Accountant/tabs/PaymentProfiles/TemplateProfileModal.tsx` (bundled with PP tab extract) | — | 60 min (with PP4) |
| **ConveraBatch** | inline 11839 | Invoices tab (Convera Batch button), QB Automation (indirect) | `src/roles/Accountant/modals/ConveraBatchModal.tsx` | CopyChip B6 | ~2 hrs |
| **IntuitBatch** | inline 12198 | Invoices tab (Intuit Batch button), QB Automation (indirect) | `src/roles/Accountant/modals/IntuitBatchModal.tsx` | CopyChip B6 | ~2 hrs |
| **QbExport** | inline 12320 | Invoices tab (Export to QB button) | `src/roles/Accountant/modals/QbExportModal.tsx` | AutocompletePicker PP2 (QB vendor edit inside), SortableHeader B4 | ~3 hrs (large modal ~450 lines) |
| **ConveraMatching** | inline 12799 | Invoices tab + PP tab entry points | `src/roles/Accountant/modals/ConveraMatchingModal.tsx` | AutocompletePicker PP2, SortableHeader B4, MultiSelectDropdown T1, `resolveLivePaymentProfile` I4 | ~4 hrs (large modal, heavy use of shared atoms) |
| **PaymentIifPreviewModal** *(M5 in audit)* | inline (locate) | Payments tab | `src/roles/Accountant/modals/PaymentIifPreviewModal.tsx` | — | ~90 min |
| **PaymentImport split** | inline 13137, spec'd in modularization-audit Slice M0 | Payments tab + PP tab | 2 new files under `src/components/payments/` per M0 spec | FileUploadCard, MultiSelectDropdown | ~4 hrs (spec ready) |
| **InvoiceDetail** *(I7)* | inline 13392 (accountant) + 15535 (TimesheetUser) | Dual-role | `src/components/InvoiceDetailModal.tsx` with `mode: 'accountant'\|'timesheetuser'` | InvoiceReconBadge I5, AutocompletePicker PP2 | ~3 hrs (mandatory tests) |
| **PaymentProfileModal** *(A6/PP3)* | inline (locate render) | 3-role cross-consumer | `src/components/PaymentProfileModal.tsx` with `mode: 'basic'\|'full'` | AutocompletePicker PP2 (QB vendor field), CountryRegionSelect A11 | ~3 hrs (mandatory tests) |
| **ClientInvoice** *(portal-mounted)* | inline 14225 | Client Estimation | Extracts with Chunk 4 CEP2 into `src/roles/Accountant/tabs/ClientEstimation/` | — | (counted in Chunk 4 CEP2) |

#### 9c. Global sequence — the master extraction order

Divided into 5 phases. Each phase's slices can ship in parallel among themselves; phases are strict dependencies.

**PHASE 1 — Foundation atoms (unlock everything downstream)**
Ship in any order. All independent.

| Slice | Extract | Effort |
|---|---|---|
| W1 | StickyScrollWrapper → `src/components/` | 20-30 min |
| T1 | MultiSelectDropdown → `src/components/` | ~2 hrs |
| T2 | SourceBadge → `src/components/` | 30 min |
| A10 | StatusBadge → `src/components/` | ~1 hr |
| PP1 (base) | FilterPills base → `src/components/` | ~90 min |
| PP2 | AutocompletePicker → `src/components/` | ~90 min |
| B4 | SortableHeader → `src/components/` | ~2 hrs |
| B6 | CopyChip → `src/components/` | ~1 hr |
| FileUploadCard | → `src/components/` | ~90 min |
| I4 | `resolveLivePaymentProfile` → `src/lib/` | 30-45 min |

**Phase 1 total: ~10-12 hrs. Highest ROI foundation.**

**PHASE 2 — Variant extensions + Client Estimation park + tab-local prerequisites**
Runs after Phase 1.

| Slice | Extract | Effort |
|---|---|---|
| PP1-ext | Extend FilterPills with `optionRenderer` + `renderExtra` + grouped variant (for Invoices + Payments consumers) | ~2 hrs |
| CEP1 | Client Estimation Path B housekeeping (drop dead code, lazy-load queries) | ~1 hr |
| CEP2 | Client Estimation Path B — encapsulate tab + ClientInvoiceModal + import preview modal into folder | ~2 hrs |
| W3 | Weekly tab extract | ~90 min |
| C1 already shipped ✅ (T7 hotfix) | | |
| C2 | Move ConsolidatedTable to `src/components/` | 30 min |
| C3 | `buildConsolidatedReport()` shared lib + Manager+Accountant unify | ~90 min |
| C4 | `downloadConsolidatedCSV` shared lib | ~45 min |
| C5 | Consolidated tab extract | 60 min |
| T3 | TimesheetDayTable (A4) shared component — corrective across 4 drift copies | ~5-6 hrs |
| T4 | Timesheet-Only tab extract | 60 min |

**Phase 2 total: ~15-18 hrs.**

**PHASE 3 — Cross-role modals**
Runs after Phase 1 atoms land (Phase 2 not strictly required).

| Slice | Extract | Effort |
|---|---|---|
| PP3 (A6) | PaymentProfileModal cross-role — Accountant + VM + TimesheetUser | ~3 hrs (mandatory tests) |
| I7 | InvoiceDetailModal dual-role — Accountant + TimesheetUser (with mode prop) | ~3 hrs (mandatory tests) |
| M0 | PaymentImport split into 2 dedicated modals | ~4 hrs |
| A11 | CountryRegionSelect (deferred — bundles with Admin extract later) | ~1.5 hrs |
| A9 | PasswordChangeForm (deferred — bundles with TimesheetUser extract later) | ~1 hr |

**Phase 3 total for arc-critical items: ~10 hrs.**

**PHASE 4 — Accountant-owned modals + tab extractions (large role work)**
Runs after Phase 1-3.

| Slice | Extract | Effort |
|---|---|---|
| PP1-adopt | Adopt FilterPills at 5 sites in PP tab + 6 sites in Invoices + 2 sites in Payments | ~3 hrs total across chunks |
| PP4 | Payment Profiles tab extract | ~90 min |
| Modals: ConveraBatch, IntuitBatch, QbExport, ConveraMatching, PaymentIif → extract | ~11 hrs combined |
| I1 | Adopt MultiSelectDropdown at Invoice contractor picker | 30 min |
| I2 | Adopt FilterPills at 5 pill rows | ~2 hrs |
| I3 | `useInvoiceFilters()` hook | ~3-4 hrs |
| I5 | InvoiceReconBadge (if dual-consumer verified) | ~45 min |
| I6 | Invoices tab extract | ~3 hrs |
| PL1 | `usePaymentsUI()` hook | ~3-4 hrs |
| PL2 | `<PaymentMatchCell>` component | ~2 hrs |
| PL3 | Adopt PP1 (grouped variant) + B4 + FileUploadCard | ~90 min |
| PL4 | ProcessPreviewModal | ~90 min |
| PL5 | Summary panels (optional) | 45 min |
| PL6 | Payments tab extract | ~3-4 hrs |
| QA1 | `computeMissingBills()` + tests | ~3 hrs |
| QA2 | `computeQbInboxGroups()` + tests | ~2 hrs |
| QA3 | `useQbSyncState()` hook | ~90 min |
| QA4 | MappingModal | ~90 min |
| QA5 | PushResultModal + PendingJobsPopup | ~60 min |
| QA6 | PostedEventRow + AlreadyPostedSection | ~2 hrs |
| QA7 | `useQbAutomation()` hook | ~3-4 hrs |
| QA8 | **UX contract snapshot tests** (HARD prereq for QA9) | ~3 hrs |
| QA9 | QB Automation tab extract | ~3-4 hrs |

**Phase 4 total: ~48-55 hrs.**

**PHASE 5 — Convera pipeline extraction (Chunk 10)**
Runs after Phase 4 tab extracts. Highest-risk phase — tests come first.

*(See Chunk 10 for full plan.)*

#### 9d. Cross-cutting decisions

**D9.1 — When to move accountant modals to their own directory?**
- Options: (a) `src/roles/Accountant/modals/` (grouped by role), or (b) `src/components/` (flat).
- Consultant rec: **`src/roles/Accountant/modals/`** for accountant-only modals (ConveraBatch, IntuitBatch, QbExport, ConveraMatching, PaymentIif, TemplateProfile). **`src/components/`** for cross-role modals (InvoiceDetail, PaymentProfileModal, PaymentImport split). Rule: if extracted to be used by ≥2 roles, `src/components/`. Single role → colocated under that role's dir.

**D9.2 — Should we finish all shared atoms (Phase 1) before ANY tab extract?**
- Pro: cleaner dependency graph, less rework.
- Con: Phase 1 total is ~12 hrs before any user-visible progress.
- Consultant rec: **do Phase 1 in a single burst**, then unblock all downstream work. Each Phase 1 atom is a small independent commit; 10-12 hrs sequential doesn't require single session.

**D9.3 — Do we ship the C3 corrective slice (Manager + Accountant Consolidated unify) or leave the drift?**
- Pro: eliminates ongoing divergence risk.
- Con: touches an already-extracted role file (Manager) — increases blast radius per commit.
- Consultant rec: **ship C3.** Behavior-locking tests + fixture comparison lock the risk. Same story for T3 (A4 TimesheetDayTable, 4 drift copies).

**D9.4 — Chunk 4 CEP2 slice — is "as-is encapsulation" enough, or should we still adopt shared atoms?**
- Consultant rec: **as-is encapsulation is sufficient** per Path B chosen 2026-09-15. Adopt shared atoms only if trivially free during the extract (e.g., ClientInvoiceModal already uses XLSX — no change needed). Do not chase atoms in parked feature.

**D9.5 — Testing scope**
- Every corrective / cross-role extraction MUST ship tests: PP3 (3-role), I7 (2-role), C3 (2-role), T3 (4-consumer), QA1 (business logic), QA2 (business logic), QA8 (UX contract).
- Tab-local extracts (W3, T4, CEP2, PP4, I6, PL6, QA9) can rely on manual smoke — behavior boundaries are within a single consumer.
- Convera pipeline (Chunk 10) needs full test coverage before extraction.

**D9.6 — Global commit cadence**
Per [[preview-branch-for-ui]] and existing pattern:
- Each atom slice = own feature branch → Vercel preview → Dan eyeball → ff-merge → cleanup.
- Never batch 2 atoms into one commit — atomicity matters if regression appears.
- CI check: `npm run build` before every push (per [[npm-build-before-push]]).

#### 9e. 🐛 Traps found in this chunk

Meta-traps about the extraction process itself:

| # | Issue | Remedy |
|---|---|---|
| T71 | **Atom API design risk.** PP1 (FilterPills) needs extension for grouped-variant + colored-active + sentinel chips before Invoices/Payments can adopt. Extending an already-extracted atom retroactively is more work than getting the API right first. | Design PP1's variant surface BEFORE extracting. Consultant proposal: `{ options, selected, onChange, multiSelect?, optionRenderer?, renderExtra?, groups? }`. Document in ADR-like block in the component file. |
| T72 | **Testing prerequisite tension** — QA8 UX contract tests need the current TS.tsx tab to run against for baseline capture. If TS.tsx changes before QA8, baseline drifts. | Capture QA8 baselines EARLY (before any Chunk 8 slice modifies the tab). |
| T73 | **Cross-role modal test coverage gap** — PP3 (PaymentProfileModal) needs test for all 3 roles' invocation paths. TimesheetUser role tests barely exist today. | Ship minimal TimesheetUser render tests as part of PP3. |
| T74 | **VendorManager already-extracted drift** — VM's `ManagerView.tsx` and `VendorManagerView.tsx` currently pass shared modal state via prop drill. When PP3 lands (A6 extraction), VM's props signature narrows — will need coordinated commit. | Bundle VM prop-signature update with PP3 slice. |
| T75 | **PaymentImport modal (Slice M0) frozen spec** — spec in `.claude/plans/modularization-audit.md` is 2 weeks old. Verify it still matches current code before executing. | Read Slice M0 spec + verify TS.tsx state before executing. |

#### 9f. Open questions

- **Q9.1** D9.1 — `src/roles/Accountant/modals/` vs `src/components/` — confirm the split rule (single-role vs multi-role)?
- **Q9.2** D9.2 — Phase 1 in one focused sprint, or interleaved with tab extracts?
- **Q9.3** T71 — draft PP1 variant API BEFORE extracting, or extract minimal + extend later?
- **Q9.4** T73 — do we ship TimesheetUser render tests as a prereq for PP3, or accept manual smoke?
- **Q9.5** Order — should Phase 3 (cross-role modals) run in parallel with Phase 2 (Weekly/Consolidated/TS-Only tab extracts), or strictly serial? They're independent.

#### 9g. What Chunk 9 delivers

The single source of truth for the extraction order across Chunks 1-8. Any deviation (Dan says "let's do X first") gets logged in §7 open Qs / decisions.

**Confidence:** high on the sequencing. Medium on the effort roll-up (Chunk 8's 18-20 hrs may compress if some slices bundle; Chunk 10's effort unknown until analyzed).

---

### Chunk 10 — Convera pipeline handler extraction (B1 — highest-risk chunk)

**Purpose:** Extract the Convera pipeline out of the pre-role section of TS.tsx into `src/lib/convera/` (pure) + `src/api/convera/` (async). **Behavior-locking tests come FIRST** per Dan 2026-09-01 caveat #4 + [[handle-process-no-tests]].

**Consumers:** Payments tab (heavy), PP tab (Convera beneficiary linking), Invoices tab (Convera Matching modal), Convera Batch modal, PaymentImport modal.

**Pre-read (all critical):**
- [[convera-matcher-guardrails]] — 3 must-survive guardrails (SYN+IBAN, checksum, Short/Long Name)
- [[convera-retrofit-reality]] — 5 structural cliffs (**this chunk preserves current behavior**; retrofit is separate)
- [[handle-process-no-tests]] — the load-bearing daily-use handler
- [[umbrella-link-table]], [[umbrella-payment-patterns]], [[bimosoft-uk-alt]], [[invoice-snapshot-vs-live]], [[qbxml-refnumber-collision]], [[normalize-ref-stacked-inv]], [[matcher-ignore]], [[convera-xls-format]]
- Note: this is NOT the Convera retrofit ([[convera-retrofit-reality]] W2/W3). That's a separate arc. Chunk 10 preserves current behavior + adds tests + extracts to modules.

#### 10a. Handler inventory

Located in TS.tsx pre-role section, ~700-5700 line range. ~2000 lines of Convera-related code.

**Pure functions (already testable in isolation):**

| Handler | Line | Purpose | Risk |
|---|---|---|---|
| `computeSynVendorCode(profileId, iban, allProfiles)` | 744 | SYN scheme generator | Medium — collision handling per [[convera-matcher-guardrails]] |
| `normaliseConveraBeneficiary(r)` | 2312 | Field mapping from raw DB row | Low |
| `autoMatchBeneficiary(name, iban, benefs, expectedSyn)` | 3394 | Match algorithm w/ SYN+IBAN corroboration | **HIGH — Fat Struct incident memory** |
| `resolveBeneficiary(beneficiary, vendorCode)` | 4759 | Fetch bene by name/code | Medium — closes over module state |
| `matchPaymentGroup(beneficiary, amount, txnDate, vendorCode, ...)` | 4774 | Umbrella match (Teal/Bimosoft) | High |
| `matchPaymentToInvoice(invoiceRef, beneficiary, ...)` | 4815 | Single-invoice match | High |

**Async data loaders:**

| Handler | Line | Purpose |
|---|---|---|
| `loadConveraBeneficiaries()` | 2333 | Fetch + normalize |
| `loadConveraLastPaymentDates()` | 3372 | Fetch cache |

**Async orchestrators (side effects, write-heavy):**

| Handler | Line | Purpose | Risk |
|---|---|---|---|
| `handlePaymentsImport` | 4965 | Parse XLS → create batch → auto-match | **Highest — daily use** |
| `handleProcess` | 5357 | 5-step commit (states / umbrella / shadow / paid / batch) | **HIGHEST — T53 flag** |
| `handleReopenBatch` | 5521 | Reverse batch + invoice paid_date | High |
| `handleRollbackBatch` | 5566 | Delete batch + rows | High |
| `applyConveraPayments` | (grep — locate) | Legacy? Per [[matcher-ignore]] verify still active | Unknown |
| `importConveraBeneficiaries(file)` | 3427 | Bulk bene XLS upload | Medium |
| `buildPaymentIifPreview(batchId)` | 4073 | Compose IIF (3-account split) | Medium |

#### 10b. Behavior-locking test targets (must exist BEFORE extraction)

**Invariants to lock (from memory + code):**

| # | Invariant | Source | Test target |
|---|---|---|---|
| INV1 | SYN match requires IBAN corroboration when both set | [[convera-matcher-guardrails]] rule 1 | `autoMatchBeneficiary` — Fat Struct-style collision test case must fall through |
| INV2 | IBAN checksum enforced (ISO 13616 mod-97) at 3 layers | [[convera-matcher-guardrails]] rule 2 | `savePaymentProfile` + edge fn + parser (some outside chunk scope) |
| INV3 | Short Name ASCII; Long Name raw | [[convera-matcher-guardrails]] rule 3 | `transliterateAscii` + create-beneficiary flow |
| INV4 | Umbrella grouping: 1 confirmation_number → N invoices → N intents | [[convera-retrofit-reality]] rule 2 + [[umbrella-link-table]] | `handleProcess` — multi-invoice test case creates N `convera_transaction_invoices` rows |
| INV5 | Bimosoft UK ALT override applies at approval | [[bimosoft-uk-alt]] | fixture: Bimosoft invoice → routing check |
| INV6 | Live-profile fetch, never trust `invoice.paymentProfile` snapshot for QB | [[invoice-snapshot-vs-live]] | `resolveBeneficiary` + `matchPaymentGroup` — snapshot-drift test case |
| INV7 | Historical matcher_ignore fence (2026-04-28 invoices / 2026-06-20 txns) | [[matcher-ignore]] | matchers exclude pre-cutoff rows |
| INV8 | `normalizeRef` handles stacked "Inv# INV-XXXXX" | [[normalize-ref-stacked-inv]] | Hover-style test case |
| INV9 | vendor-scoped RefNumber lookup (avoid collision) | [[qbxml-refnumber-collision]] | fixture with 2 vendors sharing "INV 03/26" |
| INV10 | Fee tolerance $50 (T55 — verify intent) | code const 9511 | delta calc — $50 within tolerance, $51 flagged |

**Behavior traces to lock (per handler):**

- **`handleProcess`** — 5-step sequence: state updates → umbrella links → shadow write to qb_ingest_events → invoice paid → batch state advance. Post-commit: fetchImportBatches + fetchConveraTransactions + fetchInvoices. Failure paths: any step alerts + returns.
- **`handlePaymentsImport`** — parse Convera XLS format → create batch → dedupe (new/refresh/skip/amount-changed) → auto-match on import.
- **`handleReopenBatch`** — reverse invoice paid → approved for all matched rows in batch; rows set to unreviewed; batch state → pending.
- **`handleRollbackBatch`** — delete batch + rows; revert invoice paid dates.

#### 10c. Carve-out sequence — Phase 5 (from Chunk 9)

**PHASE 5A — Test scaffolding + pure-fn extraction (WITH tests)**

**Slice V1 — Test scaffolding setup**
- Confirm Vitest config already covers `src/lib/convera/**/*.test.ts` (Vite convention likely).
- Create fixtures directory: sample Convera XLS bytes, sample invoices, sample profiles, sample beneficiaries (Fat Struct scenario, Bimosoft, Teal, TCode).
- Mock Supabase client shape.
- **Effort:** ~3-4 hrs.

**Slice V2 — Behavior-locking tests for pure functions** *(BEFORE V3)*
- `computeSynVendorCode` — 5-6 cases (collision, sequential IDs).
- `normaliseConveraBeneficiary` — field mapping variants.
- `autoMatchBeneficiary` — SYN+IBAN corroboration (INV1: Fat Struct pass-through), IBAN fallback (INV2), name fallback, no-match null return.
- `resolveBeneficiary` — vendor code priority, name fallback.
- `matchPaymentGroup` — umbrella (INV4), single-invoice, no-match.
- `matchPaymentToInvoice` — INV6 (live-profile), INV7 (matcher_ignore fence), INV8 (stacked ref), INV9 (vendor-scoped ref).
- **Effort:** ~6-8 hrs. Test-first.

**Slice V3 — Extract pure functions to `src/lib/convera/`**
- `src/lib/convera/computeSynVendorCode.ts`
- `src/lib/convera/normaliseBeneficiary.ts`
- `src/lib/convera/autoMatchBeneficiary.ts` — **HIGH-RISK; move Fat Struct guardrail comment inline**
- `src/lib/convera/resolveBeneficiary.ts`
- `src/lib/convera/matchPaymentGroup.ts`
- `src/lib/convera/matchPaymentToInvoice.ts`
- All V2 tests move with them.
- Update TS.tsx call sites to `import { ... } from './lib/convera/*'`.
- **Zero-regression check:** V2 tests pass + Payments tab smoke.
- **Effort:** ~3-4 hrs.

**PHASE 5B — Behavior-locking tests for orchestrators**

**Slice V4 — Orchestrator test harness**
- Mock Supabase client with query/mutation recording.
- End-to-end fixtures.
- **Effort:** ~2-3 hrs.

**Slice V5 — `handleProcess` tests** *(HIGHEST-RISK)*
- Single-invoice match commit (INV4 baseline)
- Multi-invoice umbrella commit (INV4 verify)
- no_invoice path (state='no_invoice', no invoice touched)
- Already-paid invoice warning surfaces but proceeds
- Batch fully-processed transition (`import_batches` state)
- Shadow write to `qb_ingest_events`
- Post-commit refetch calls fire
- Failure paths (each step alerts + returns; state not corrupted)
- **Effort:** ~4-5 hrs.

**Slice V6 — `handlePaymentsImport` tests**
- New batch creation
- Refresh unreviewed rows in-place
- Skip already-processed rows
- Amount-changed detection surfaces in summary
- Auto-match on import (V3 `autoMatchBeneficiary` verified callthrough)
- **Effort:** ~3 hrs.

**Slice V7 — `handleReopenBatch` + `handleRollbackBatch` tests**
- Reopen reverses invoice paid → approved, rows → unreviewed, batch → pending
- Rollback deletes rows + batch
- **Effort:** ~2 hrs.

**PHASE 5C — Extract orchestrators**

**Slice V8 — Extract orchestrators to `src/api/convera/`**
```
src/api/convera/
  handleProcess.ts
  handlePaymentsImport.ts
  handleReopenBatch.ts
  handleRollbackBatch.ts
  importConveraBeneficiaries.ts
  loadConveraBeneficiaries.ts
  loadConveraLastPaymentDates.ts
  # applyConveraPayments.ts — ABSENT as of 2026-09-16 (`7d82dfc` grep). Watchpoint: if it reappears before Phase 5, add to this extraction list.
```
- Each accepts `{ supabase, ...args }` and returns typed result.
- No JSX, no useState.
- Payments tab consumers become `await handleProcess({ supabase, stagedMatches, ... })`.
- **Zero-regression check:** V5-V7 tests pass + Payments tab full manual smoke.
- **Effort:** ~4-5 hrs.

**Slice V9 — Extract `buildPaymentIifPreview` to `src/lib/convera/iif.ts`**
- Pure fn (returns preview data, no side effects).
- Tests for 3-account IIF composition per [[convera-retrofit-reality]] rule 1.
- **Effort:** ~2 hrs.

**Slice V10 — Payments tab (PL7) integration**
- Update `src/roles/Accountant/tabs/Payments/index.tsx` to import from `src/api/convera/*`.
- Remove call-site changes from TS.tsx pre-role (handlers can now be deleted from pre-role).
- **Zero-regression check:** Payments tab weekly-use smoke.
- **Effort:** ~90 min.

**Slice V11 — Delete pre-role Convera handlers from TS.tsx**
- After V10 lands and Payments tab is verified stable.
- Delete lines 744 (SYN), 2312 (normalise), 2333 (loadBenefs), 3372 (loadLastPay), 3394 (autoMatch), 3427 (importBenefs), 4073 (iif), 4759 (resolve), 4774 (group), 4815 (toInvoice), 4965 (import), 5357 (process), 5521 (reopen), 5566 (rollback). `applyConveraPayments` was absent as of 2026-09-16 — check again at Phase 5 start and add its location if it reappeared.
- ~2000 lines removed from TS.tsx.
- **Zero-regression check:** build + Payments tab + PP tab (Import Benefs button) smoke.
- **Effort:** 90 min.

**Total Chunk 10 effort:** ~30-35 hrs across 11 slices. Highest-risk phase in the arc.

#### 10d. 🐛 Traps found

| # | Issue | Severity | Remedy |
|---|---|---|---|
| T76 | `handleProcess` sub-steps are NOT atomic. If step 3 (mark paid) fails after step 2 (umbrella links written), links stay orphaned pointing at approved-status invoices. | Latent data integrity risk. | Note in Chunk 10 §10e as future work — atomic RPC/transaction. NOT in scope for extraction. |
| T77 | Shadow write to `qb_ingest_events` intentionally non-fatal (try/catch swallows). Silent failure = QB Automation classifier misses update. | Silent failure risk. | On extract: emit metric / event on shadow failure so ops can spot drift. |
| T78 | `handlePaymentsImport` is ~400 lines. Multi-responsibility (parse + dedupe + insert + auto-match). | Comprehension + testability. | On V8 extract, decompose into 4 helpers under `src/api/convera/handlePaymentsImport/`. |
| T79 | `applyConveraPayments` — grepped but not read; may be superseded per [[matcher-ignore]] cutoffs. | Elimination candidate? | **Verify BEFORE extracting** — grep callers, ask Dan if legacy. If dead, delete. |
| T80 | Umbrella test fixtures (Bimosoft, Teal, TCode) need real-world shapes. | Test quality. | Synthesize from [[umbrella-payment-patterns]] documented patterns; supplement with anon'd snapshots from DB. |
| T81 | `buildPaymentIifPreview` uses hard-coded Key Point → WU → A/P split. Retrofit changes this. | None here. | Chunk 10 preserves current behavior. Retrofit is separate. Add code comment. |
| T82 | Convera write path (IIF) is manual-download only today. No qbXML pipeline for Convera pushes. Per [[convera-retrofit-reality]]. | Feature gap. | Not in scope. Note. |
| T83 | Tests V2 pure-fn coverage will find bugs — likely at least 1-2 edge cases surface. Budget time for fix-before-extract. | Discovery risk. | Budget +20% on V2 effort. |
| T84 | Once V8 extracts orchestrators, cross-consumers (Convera Matching modal, PaymentImport modal, PP tab Import Benefs button) need import updates. Coordinate. | Coupling. | V8 slice ends with a grep for old handler names, update all sites. |
| T85 | Chunk 10 depends on Chunk 7 PL6 (Payments tab extract) already having consumed handlers as props. If PL6 is not done, V10 has more surface. | Sequencing. | Chunk 10 is Phase 5 in the global sequence (Chunk 9). Do not start V-slices until PL6 lands. |

#### 10e. Open questions

- **Q10.1** Test framework — Vitest (Vite native) or Jest? Consultant rec: **Vitest** — matches existing `.test.ts` files in `src/lib/`.
- **Q10.2** T79 `applyConveraPayments` — is it still called operationally? If dead, delete instead of extract. Consultant rec: **verify with grep + Dan** before Chunk 10 starts.
- **Q10.3** T76 atomic transaction rework — in scope for Chunk 10 or future work? Consultant rec: **future**. Chunk 10 preserves behavior + adds tests. Atomic RPC is a real-work slice on its own.
- **Q10.4** T77 shadow-write metric — worth adding during V8, or defer? Consultant rec: **during V8** — no extra branch, small comment + `console.warn` upgrade to a proper telemetry hook (if one exists).
- **Q10.5** T78 `handlePaymentsImport` decomposition — bundle with V8, or separate slice? Consultant rec: **bundle** — the decomposition serves the extraction naturally.
- **Q10.6** Convera retrofit ([[convera-retrofit-reality]] W2/W3) — schedule this arc after Chunk 10 or independently? Consultant rec: **independently** — retrofit is a design project, this arc is refactoring. Don't couple.

#### 10f. What Chunk 10 does NOT touch

- Convera retrofit (3-account bank split, umbrella fanout, fee allocation).
- Any qbWrite / qbXML surface (`src/lib/qbWrite/`, `src/lib/qbxml/`).
- The Payments tab UI itself (that's Chunk 7 PL6).
- Convera Matching modal / Convera Batch modal (Chunk 9 modals).
- Ingest edge functions (`supabase/functions/ingest-invoice/`).

#### 10g. Confidence + risk summary

**Confidence:** high on V1-V3 (pure functions, well-defined). Medium on V4-V7 (orchestrator test harness is new territory). Medium-high on V8-V11 (extraction is mechanical once tests exist).

**Risk mitigation:**
- Tests-first order is non-negotiable per [[handle-process-no-tests]].
- Do not touch pre-role handlers until V3 pure-fn extraction + V8 orchestrator extraction complete + Payments tab smoke passed.
- Full-file diff review by Dan on V11 (the delete-from-pre-role slice) before merge.

**This is the last chunk before final synthesis (Chunk 11).**

---

### Chunk 11 — Final synthesis: executable slice master

**Purpose:** Roll up Chunks 1-10 into an executable multi-session plan. This is the deliverable — a working document Dan uses to actually run the arc across the coming weeks.

#### 11a. Headline numbers

| Metric | Current | Target after arc | Change |
|---|---|---|---|
| TS.tsx line count | 15,871 | ~3,500-4,500 | **~-11,500 lines / -73%** |
| Total slices | — | ~50 slices | — |
| Total effort | — | **~130-150 hrs** | across 15-20 focused sessions |
| Sessions estimated | — | 15-20 (7-10 hr sprints) | over 4-6 weeks calendar |
| New directories | — | `src/roles/Accountant/`, `src/lib/convera/`, `src/api/convera/`, `src/hooks/`, `src/lib/qbAutomation/` | — |
| Tests added | 2 (existing `.test.ts` in lib) | ~30+ (pure fns + orchestrators + UX contract) | +30 |
| Handlers relocated from pre-role | 0 | ~25 handlers | massive un-scattering |
| useState hooks moved into tab files | 0 | ~50+ hooks | massive un-scattering |

#### 11b. Master slice sequence — the deliverable

Total ~50 slices across 5 execution phases. Each row: ID · slice name · effort · depends on · behavior-locking check · memory-save trigger.

**PHASE 1 — Foundation atoms (parallel-safe, unlock everything downstream) — ~10-12 hrs**

| ID | Slice | Effort | Depends | Zero-regression check | Save memory? |
|---|---|---|---|---|---|
| W1 | StickyScrollWrapper → `src/components/` | 20-30 min | — | Build + eyeball 4 scroll-wrapped pages | No |
| T1 | MultiSelectDropdown → `src/components/` | ~2 hrs | — | TS-Only picker search + select-all + Done | No |
| T2 | SourceBadge → `src/components/` | 30 min | — | Weekly + TS-Only Portal/Email chips render | No |
| A10 | StatusBadge → `src/components/` | ~1 hr | — | 15 sites render identical colored pills | No |
| PP1 | FilterPills base → `src/components/` | ~90 min | — | PP tab 4-chip row works | No |
| PP2 ⚠ SUPERSEDED — see §1b-C (QbVendorNameEditor, 2 sites) | AutocompletePicker → `src/components/` | ~90 min | — | PP tab QB vendor edit — Enter/Escape/✓/✕ | No |
| B4 | SortableHeader → `src/components/` | ~2 hrs | — | Client Est + Missing QB Bills + Already Posted sort work | No |
| B6 | CopyChip → `src/components/` | ~1 hr | — | (verify 3 modal sites after respective modal extracts) | No |
| I4 | `resolveLivePaymentProfile` → `src/lib/paymentProfileResolver.ts` | 30-45 min | — | Payments QB Export pre-selection works | No |
| FileUploadCard | → `src/components/` | ~90 min | — | (deferred — verify after 3 sites are ready) | No |

**PHASE 2 — Easy tab extracts + shared logic + variant extensions — ~15-18 hrs**

| ID | Slice | Effort | Depends | Zero-regression check | Save memory? |
|---|---|---|---|---|---|
| C1 ✅ | Stale "click Apply" hotfix | — | — | Shipped `ce527f1` | Done |
| PP1-ext | Extend FilterPills with `optionRenderer`+`renderExtra`+grouped variant | ~2 hrs | PP1 | Extension works with fixture consumers | Yes |
| C2 | ConsolidatedTable → `src/components/` | 30 min | **W1** (⚠ §1b F1) | Manager + Accountant Consolidated tables identical | No |
| C3 | `buildConsolidatedReport()` → `src/lib/consolidatedReport.ts` + unify Manager+Accountant | ~90 min + tests | C2 | **Tests locking Manager + Accountant output shape for fixture** | Yes — corrective slice per [[reusability-lens]] |
| C4 | `downloadConsolidatedCSV()` → `src/lib/consolidatedCsv.ts` | ~45 min | C3 | Byte-diff CSVs before/after per role | No |
| C5 | Consolidated tab → `src/roles/Accountant/tabs/Consolidated.tsx` | 60 min | C2-C4 | All interactions work; test-account toggle + project filter + range change + 2 CSV variants | No |
| W3 | Weekly tab → `src/roles/Accountant/tabs/Weekly.tsx` | 60-90 min | W1, A10, T2 (optional) | KPIs + table + Prev/Next + CSV + Print all match | No |
| T3 ⚠ SUPERSEDED — see §1b-C (descoped to DayHourCells, ~2 hrs, Weekly excluded) | TimesheetDayTable (A4) shared component + tests | ~5-6 hrs + tests | — | **Tests + smoke all 4 consumers (Weekly, TS-Only, Manager, VendorManager)** | Yes — corrective per [[reusability-lens]] |
| T4 | Timesheet-Only tab → `src/roles/Accountant/tabs/TimesheetOnly.tsx` | 60 min | T1, T3 | Picker + range + table + CSV + row-click modal | No |
| CEP1 | Client Est housekeeping (drop dead code T23/T24, lazy-load queries T26) | ~1 hr | — | Load-time queries deferred; tab loads first-time | No |
| CEP2 | Client Est encapsulate to `src/roles/Accountant/tabs/ClientEstimation/` (Path B) | ~2 hrs | CEP1 | All features work identically | Yes — Path B decision |

**PHASE 3 — Cross-role modals — ~10 hrs**

| ID | Slice | Effort | Depends | Zero-regression check | Save memory? |
|---|---|---|---|---|---|
| PP3 (A6) ⚠ GATED on §1b-G bug #1; see §1b-C | PaymentProfileModal cross-role (Accountant + VM + TimesheetUser) + tests | ~3 hrs + tests | PP2, A11 (⚠ F11) | **Tests for 3 role modes; VM prop signature narrows** | Yes — compound cross-role |
| I7 ⚠ SUPERSEDED — see §1b-C (accountant-only, ~818 lines, 6–8 hrs, after I6) | InvoiceDetailModal dual-role + tests | ~3 hrs + tests | PP2, I5 (opt) | **Tests for 2 role modes** | Yes — dual-role |
| M0 | PaymentImport split into `ImportIntuitPaymentsXlsx` + `ImportConveraBeneficiaries` | ~4 hrs | T1, FileUploadCard | Both flows work independently; Import Beneficiaries panel from PP tab | Yes — resolves T28/T29 coupling |

**PHASE 4 — Big tab extracts + accountant modals + QB tab — ~48-55 hrs**

| ID | Slice | Effort | Depends | Zero-regression check | Save memory? |
|---|---|---|---|---|---|
| PP4 | Payment Profiles tab → `src/roles/Accountant/tabs/PaymentProfiles.tsx` (+ TemplateProfileModal bundled) | ~90 min | PP1, PP2, PP3 | All 4 filter chips, expand-all/collapse-all, inline QB vendor edit, Re-link, Delete, +New, From-template | No |
| I1 | Adopt MultiSelectDropdown at Invoice contractor picker | 30 min | T1 | Picker works | No |
| I2 | Adopt FilterPills at 5 pill rows | ~2 hrs | PP1-ext | 5 pill rows visually + functionally identical | No |
| I3 | `useInvoiceFilters()` hook + snapshot tests | ~3-4 hrs + tests | — | **Snapshot tests locking filter output for fixtures** | Yes — un-scattering |
| I5 | `<InvoiceReconBadge>` (if dual-consumer verified Q6.3) | 30-45 min | — | Recon badge renders identical in tab + modal | No |
| I6 | Invoices tab → `src/roles/Accountant/tabs/Invoices.tsx` | ~3 hrs | I1-I3, **X3** (⚠ F13) | Every filter axis, every KPI card, every modal opens, umbrella groups render (Teal + Bimosoft), row actions | No |
| CB ⚠ GATED on X5/X6 (§1b-C) | ConveraBatchModal → `src/roles/Accountant/modals/ConveraBatchModal.tsx` | ~2 hrs | B6, **X6** | Modal renders + copy chips work | No |
| IB | IntuitBatchModal → `src/roles/Accountant/modals/IntuitBatchModal.tsx` | ~2 hrs | B6 | Modal renders + copy chips work | No |
| QE | QbExportModal → `src/roles/Accountant/modals/QbExportModal.tsx` | ~3 hrs | PP2(QbVendorNameEditor), B4, **X7**, `saveQbVendorName`, `saveInvoiceExportStatus`, `bulkMarkInvoiceExportStatus`, `qbVendorEditing*` (⚠ F2) | Category filter, ready-selection, batch push, QB vendor inline edit | No |
| CM | ConveraMatchingModal → `src/roles/Accountant/modals/ConveraMatchingModal.tsx` | ~4 hrs | PP2, B4, T1, I4 | Beneficiary picker + IBAN checks + resolve live profile | No |
| PI | PaymentIifPreviewModal → `src/roles/Accountant/modals/` | ~90 min | — | IIF text preview + Download button | No |
| PL1 ⚠ SUPERSEDED — runs AFTER V8 (§1b-C, T86) | `usePaymentsUI()` hook (or split into 3 per Q7.3) | ~3-4 hrs | **V8** | Rows/counts/candidates match | Yes — un-scattering |
| PL2 | `<PaymentMatchCell>` component | ~2 hrs | PL1 | Match cell renders identical: chips, delta, +Add dropdown, No-invoice | No |
| PL3 | Adopt PP1 grouped variant + B4 + FileUploadCard | ~90 min | PP1-ext, B4, FileUploadCard | State pills + batch pills + sort headers + import UX | No |
| PL4 | ProcessPreviewModal → `src/roles/Accountant/tabs/Payments/` | ~90 min | PL1 | Stage matches → Preview → Confirm → Post-summary | No |
| PL5 | PostImport + PostProcess summary panels (optional) | 45 min | — | Panels render as before | No |
| PL6 ⚠ SUPERSEDED — runs AFTER V8 (§1b-C) | Payments tab → `src/roles/Accountant/tabs/Payments/index.tsx` | ~3-4 hrs | PL1-4, **V8** | **Extensive smoke — critical daily-use surface** (see Chunk 7 §7e PL6) | No |
| QA1 | `computeMissingBills()` → `src/lib/qbAutomation/missingBills.ts` + tests | ~3 hrs + tests | — | **Tests locking cutoff + path + mirror-check logic** | Yes — business-critical |
| QA2 | `computeQbInboxGroups()` → `src/lib/qbAutomation/inboxGroups.ts` + tests | ~2 hrs + tests | — | **Tests locking classifier logic** | Yes — business-critical |
| QA3 | `useQbSyncState()` hook | ~90 min | — | Header freshness + heartbeat + sync buttons match | No |
| QA4 | MappingModal → `src/roles/Accountant/tabs/QbAutomation/MappingModal.tsx` | ~90 min | PP2 | Vendor mapping widget opens + saves + deletes | No |
| QA5 | PushResultModal + PendingJobsPopup | ~60 min | — | Both popups render + dismiss | No |
| QA6 | PostedEventRow + AlreadyPostedSection | ~2 hrs | B4 | Posted rows render, month rollup expand/collapse, sort works | No |
| QA7 ⚠ SUPERSEDED — see §1b-C (needs X4 first; catalog + vendorDecision + qbExport* + qbVendorEditing* stay at wrapper; 6–8 hrs) | `useQbAutomation()` hook (owns all tab-local QB state, splits `qbInboxExpanded` per T57) | ~3-4 hrs | QA1, QA2, QA3, **X4** | All groups, counters, filters match | Yes — un-scattering |
| QA8 | **UX contract snapshot tests** — HARD PREREQ for QA9 | ~3 hrs | — | Snapshot tests fail if UX rules 1-6 violated | Yes — [[qb-ux-contract-untested]] resolution |
| QA9 | QB Automation tab → `src/roles/Accountant/tabs/QbAutomation/index.tsx` | ~3-4 hrs | QA1-QA8 | **QA8 snapshot tests + extensive manual smoke** — see Chunk 8 §8e QA9 | No |

**PHASE 5 — Convera pipeline extraction (highest-risk) — ~30-35 hrs**

| ID | Slice | Effort | Depends | Zero-regression check | Save memory? |
|---|---|---|---|---|---|
| V1 | Test scaffolding + fixtures | ~3-4 hrs | (Vitest confirmed Q10.1) | Tests run | No |
| V2 | Behavior-locking tests for 6 pure fns (INV1-INV3, INV6-INV9) | ~6-8 hrs | V1 | All INV tests pass against current inline impl | Yes — [[handle-process-no-tests]] resolution |
| V3 | Extract 6 pure fns to `src/lib/convera/*` | ~3-4 hrs | V2 | V2 tests pass against extracted; Payments tab smoke | No |
| V4 | Orchestrator test harness | ~2-3 hrs | V3 | Mock Supabase records mutations | No |
| V5 | `handleProcess` tests (INV4 umbrella, all commit paths) | ~4-5 hrs | V4 | Tests pass against current inline impl | Yes — HIGHEST-RISK handler |
| V6 | `handlePaymentsImport` tests | ~3 hrs | V4 | Tests pass | No |
| V7 | `handleReopenBatch` + `handleRollbackBatch` tests | ~2 hrs | V4 | Tests pass | No |
| V8 | Extract orchestrators to `src/api/convera/*` — **no setState inside; `applyConveraPayments` does not exist (§1b-A)** | ~4-5 hrs | V5-V7 | All V5-V7 tests pass against extracted | No |
| V9 ⚠ SUPERSEDED — replaced by X7 (§1b-C) | `buildPaymentIifPreview` → `src/lib/convera/iif.ts` + tests | ~2 hrs | — | 3-account IIF composition tests | No |
| V10 | Payments tab (PL7) integration | ~90 min | V8, PL6 (PL6 now follows V8 — §1b-C) | Payments tab weekly-use smoke | No |
| V11 | Delete Convera handlers from TS.tsx pre-role (~2000 lines removed) | 90 min | V10 | Build + Payments + PP + Invoices smoke; **Dan full-file-diff review before merge** | Yes — arc completion milestone |

#### 11c. Session-block recommendations

15-20 focused sessions of 7-10 hrs. Suggested groupings:

| Session | Focus | Slices | Effort |
|---|---|---|---|
| S1 (this session) | Planning arc complete | — | — |
| S2 | Foundation atoms sprint | W1, T1, T2, A10, PP1, PP2 | ~7-8 hrs |
| S3 | Remaining atoms + easy tab extract | B4, B6, I4, W3 | ~5-6 hrs |
| S4 | Consolidated arc (corrective) | C2, C3, C4, C5 + PP1-ext | ~5-6 hrs |
| S5 | Timesheet-Only + Client Est park | T3 (compound), T4, CEP1, CEP2 | ~8-9 hrs |
| S6 | Cross-role modals | PP3 (compound), I7, M0 | ~10 hrs |
| S7 | Payment Profiles tab | PP4 + start Invoices | ~4-5 hrs |
| S8 | Invoices tab | I1, I2, I3 (hook + tests), I5, I6 | ~9-10 hrs |
| S9 | Accountant modals sweep | CB, IB, QE, CM, PI | ~12 hrs |
| S10-11 | Payments tab | PL1-PL6 | ~11-13 hrs |
| S12-14 | QB Automation | QA1-QA9 (QA8 test set is standalone session) | ~18-20 hrs |
| S15-17 | Convera pipeline pure fns + tests | V1-V3 | ~12-16 hrs |
| S18-19 | Convera orchestrator tests + extract | V4-V8 | ~15-18 hrs |
| S20 | Convera cleanup + arc completion | V9-V11 | ~4-5 hrs |

**Calendar estimate:** if 1-2 sessions per week, ~10-20 weeks (2.5-5 months). If 3-4 per week, ~5-8 weeks.

#### 11d. Prerequisites/gating checklist per phase

**Before Phase 1 starts:**
- ✅ Plan doc reviewed
- ⚠ Q10.1 answered — Vitest confirmed as test framework
- ⚠ Q9.3 answered — PP1 FilterPills variant API design draft (either commit to consultant proposal or Dan sketches)

**Before Phase 3 starts (cross-role modals):**
- All Phase 1 atoms landed
- ⚠ Q9.4 answered — TimesheetUser render test scaffolding (needed for PP3 + I7)

**Before Phase 4 QA9 starts (QB Automation tab extract):**
- QA8 UX contract snapshot tests landed (HARD)
- QA1, QA2, QA3, QA7 landed
- ⚠ Q8.3 answered — vendor-mapping surfaces (consolidate or keep both)

**Before Phase 5 starts (Convera pipeline):**
- Chunk 7 PL6 landed (Payments tab extract)
- ⚠ Q7.2 answered — fee tolerance $50 intent (affects V2 tests INV10)
- ⚠ Q10.2 answered — `applyConveraPayments` alive or dead
- ⚠ Q10.3 answered — atomic RPC in scope or future

#### 11e. Open questions summary (30 total, ranked)

**GATING (must answer before affected slice starts):**

| Q | Chunk | What | Affects | Priority |
|---|---|---|---|---|
| Q10.1 | 10 | Vitest vs Jest | V1 | Before Phase 1 |
| Q9.3 | 9 | PP1 variant API — design or retrofit | PP1 | Before Phase 1 |
| Q9.4 | 9 | TimesheetUser render tests scaffold | PP3 | Before Phase 3 |
| Q10.2 | 10 | `applyConveraPayments` alive? | V8 | Before Phase 5 |
| Q7.2 | 7 | Fee tolerance $50 intent | V2 INV10 | Before Phase 5 |
| Q8.3 | 8 | Vendor-mapping surfaces consolidate? | QA9 | Before QA9 |
| Q10.3 | 10 | Atomic RPC for `handleProcess` | V8 or future | Before Phase 5 |

**CONSULTANT DEFAULTS (proceed unless Dan overrides):**

Q1.1 (skip W2 lib extract), Q1.2 (leave Prev/Next dup), Q1.3 (defer StatusBadge/SourceBadge to Chunk 9), Q2.1 (Manager `excludeTest` intentional), Q2.2 (verify `sourceCounts` in ConsolidatedTable body), Q3.1 (T3 split per-role), Q3.2 (`src/components/` not `src/features/`), Q3.3 (fix T14 during T4), Q4.3 (ClientInvoiceModal single-consumer verified), Q4.4 (keep portal-mount pattern), Q5.1 (PP1→PP2→PP3→PP4 sequential), Q5.2 (`mode: 'basic'|'full'` preset), Q5.3 (split `qbVendorEditingId` per caller), Q6.1 (extend PP1 with `optionRenderer`), Q6.2 (I7 to Chunk 9), Q6.3 (verify recon dual-consumer during I5), Q6.4 (tab-scope `qbExportSnapshot`), Q7.1 (extend PP1 grouped), Q7.3 (split `usePaymentsUI` into 3 hooks), Q7.4 (PL4 in Chunk 7 not 9), Q8.1 (controlled MappingModal), Q8.2 (RTL + 1 Playwright smoke), Q8.4 (`qbInboxExpanded` split during QA7), Q8.5 (push orchestrator pure fn in lib), Q9.1 (single-role → roles/Accountant/modals, multi-role → components), Q9.2 (Phase 1 in one sprint), Q9.5 (Phase 2+3 parallel-safe), Q10.4 (shadow-write metric during V8), Q10.5 (bundle T78 decomposition), Q10.6 (retrofit is independent arc).

#### 11f. Success criteria

Arc complete when ALL of:
- [ ] TS.tsx down to ~6,000–6,500 lines (from 15,871) — amended 2026-09-16 §1b-F; 3,500–4,500 requires Phase 6 (deferred to TSU arc)
- [ ] `src/roles/Accountant/` contains 8 tabs + 6+ modals + `hooks/` + `useQbAutomation` + `usePaymentsUI`
- [ ] `src/lib/convera/` contains 6 pure fns + `iif.ts` + tests
- [ ] `src/api/convera/` contains 7 async ops + tests
- [ ] `src/lib/qbAutomation/` contains `missingBills.ts` + `inboxGroups.ts` + tests
- [ ] `src/components/` contains 10+ shared atoms
- [ ] All existing accountant functionality works (weekly smoke passes)
- [ ] All Convera pipeline handlers have test coverage
- [ ] QB Automation UX contract has snapshot tests
- [ ] MEMORY.md updated with completion status
- [ ] `project_accountant_modularization.md` marked COMPLETE

**Fail-safes:**
- Every slice ships on feature branch → Vercel preview → Dan eyeball → ff-merge (per [[preview-branch-for-ui]]).
- `npm run build` before every push (per [[npm-build-before-push]]).
- Any slice touching Convera or QB Auto requires tests (per Dan 2026-09-01 caveat #4).
- No slice half-lands. Main always deployable.

#### 11g. What comes AFTER this arc

Separate arcs (not in scope):
- Convera retrofit W2/W3 per [[convera-retrofit-reality]] — 3-account split, umbrella fanout, fee allocation
- TimesheetUser role extraction (1,228 lines)
- Admin role extraction
- Auth screens extraction (Login + SetPassword)
- pg_cron S2 (extend delta polling to `bill_pmt_query`)
- Reports tab + Help button per [[reports-and-help-backlog]]

Follow-on from arc:
- Fold [[project_manager_role_dormant]] into a review — do we un-park Manager/VM roles or keep dormant?
- Consider `src/features/` directory adoption if a smart-state feature emerges (e.g., Reports tab).
- Retire `[[qb-automation-ux-contract]]` snapshot tests into a lint rule if pattern stabilizes.

**Confidence:** high on the sequence + prereqs. Medium on effort estimates (real numbers will slip 20-30% per [[dont-overpad-estimates]]). Zero-regression checks are the safety net — trust them, not the estimates.

---

## Arc analysis COMPLETE — 2026-09-15 S1

11 chunks × ~50 slices × ~130-150 hrs planned. Living doc ready for execution. Next session: pick a phase, start executing.



---

## 7. Open questions / decisions log

- **Q2.1 (open)** Is Manager's absence of `excludeTestAccounts` intentional (managers manage real people, no test accounts) or drift?
- **Q2.2 (resolved 2026-09-16 review)** `sourceCounts` IS rendered — 5th KPI card in `ConsolidatedTable`. Keep it. See §1b-A.
- **Q2.3 (resolved 2026-09-15 S1)** Hotfix pulled to branch `hotfix/consolidated-empty-state-copy`, commit `ce527f1`. Removed T7 from pending-checks.
- **Q3.1 (open)** T3 compound slice — one commit or split per role file?
- **Q3.2 (open)** `src/features/` directory: adopt now (audit suggests) or defer until first smart-state feature (Invoice workbench)?
- **Q3.3 (open)** T14 lazy-null init — fix during T4 extract, or leave?
- **Q4.1 (resolved 2026-09-15 S1)** Dan: **Path B — Prototype / parked.** Chunk 4 execution follows §4h only. Paths A + C deprecated but kept in doc for archaeology.
- **Q4.2 (resolved 2026-09-15 S1)** Tables stay. Feature is paused, not deleted; data retention is cheap.
- **Q4.3 (open)** Confirm ClientInvoiceModal has no other callers (Manual Invoice uses Convera bene card per [[manual-invoice-2026-09]], different modal).
- **Q4.4 (open)** T27 — keep portal-mount pattern after extract, or normal mount?
- **Q5.1 (open)** PP1 + PP2 order — any preference or trust consultant sequencing?
- **Q5.2 (open)** PP3 field-visibility API — `mode: 'basic' \| 'full'` (preset) or granular `showX` props?
- **Q5.3 (open)** T32 — split `qbVendorEditingId` per caller, or keep dual-consumer shared state?
- **Q6.1 (open)** FilterPills variant API — extend PP1 with `optionRenderer` + `renderExtra`, or split into two components?
- **Q6.2 (open)** InvoiceDetail modal (I7) — Chunk 6 or Chunk 9 modal sweep?
- **Q6.3 (open)** Recon cell dual-consumer? Verify InvoiceDetail renders similar recon UI.
- **Q6.4 (open)** `qbExportSnapshot` ownership — tab-scope (current) or modal-scope on extract?
- **Q7.1 (open)** PP1 FilterPills — extend with `renderGroups` variant, or accept inline grouped pills for Payments?
- **Q7.2 (resolved 2026-09-16 S2, Dan)** T55 fee tolerance $50 — unsure of intent. Lock current $50 value with V2 INV10 test + code comment; open follow-up ticket to revisit per-vendor. Does not block Phase 5.
- **Q7.3 (open)** `usePaymentsUI()` — one hook or split into 3 (filters / staging / candidates)?
- **Q7.4 (open)** PL4 ProcessPreviewModal — extract with PL sequence or in Chunk 9 modals sweep?
- **Q8.1 (open)** MappingModal QA4 — controlled or uncontrolled state pattern?
- **Q8.2 (open)** UX contract QA8 — RTL shape tests + 1 Playwright smoke, or all Playwright?
- **Q8.3 (deferred 2026-09-16 S2, Dan)** T64 — defer decision to QA9 scoping. QA9 planning surfaces the actual overlap and cost.
- **Q8.4 (open, narrowed 2026-09-16)** `qbInboxExpanded` T57 split — during QA7 or hold? (No localStorage persistence exists — no migration concern. See §1b-A.)
- **Q8.5 (open)** Push orchestrator T63 — pure fn in `src/lib/` or hook method?
- **Q9.1 (open)** Modal home rule — `src/roles/Accountant/modals/` for single-role, `src/components/` for multi-role. Confirm?
- **Q9.2 (open)** Phase 1 foundation atoms — one focused sprint (10-12 hrs) or interleaved with tab extracts?
- **Q9.3 (resolved 2026-09-16 S2, Dan)** PP1 FilterPills — extend retroactively as consumers reveal needs. Ship base API + `optionRenderer`/`renderExtra`/`renderGroups` added when a real consumer requires them.
- **Q9.4 (resolved 2026-09-16 S2, Dan)** X1 (jsdom + `@testing-library/react` + `@testing-library/jest-dom` + one smoke test on `<MonthRangePicker>`) shipped in Phase 0. Enables E6 tests-first slices (PP3, I7, QA8, T3-descoped).
- **Q9.5 (open)** Phase 2 + Phase 3 — strictly serial or parallel-safe?
- **Q10.1 (resolved 2026-09-16 review)** Vitest — already installed, `npm test`, 14 existing test files. See §1b-A.
- **Q10.2 (resolved 2026-09-16 S2, Dan)** `applyConveraPayments` does not exist in `src/` (grep-verified 2026-09-16 tip `7d82dfc`). Plan-doc V8/V11 file lists updated to say "absent as of 2026-09-16 — watchpoint; if it reappears before Phase 5, add to extraction list" rather than fully removing the reference.
- **Q10.3 (resolved 2026-09-16 S2, Dan)** T76 atomic-transaction rework for `handleProcess` — FOLLOW-UP ARC. V5 tests lock the current stepped behavior (including stale-on-failure quirk); do not "fix" in this arc. Does not block Phase 5.
- **Q10.4 (open)** T77 shadow-write metric — during V8 or defer?
- **Q10.5 (open)** T78 `handlePaymentsImport` decomposition — bundle with V8 or separate?
- **Q10.6 (open)** Convera retrofit W2/W3 — after Chunk 10 or independent arc?
- **New reusability guardrail (S1, from Dan):** every chunk must check whether a variation exists in another role/flow, and lean toward extract-to-lib-or-components even for "single-caller today" candidates. Codified in §2.
- **Print @media follow-up (logged 2026-09-16 S2, W3):** Weekly tab Print button opens the browser print dialog but produces empty pages because the app has zero `@media print` rules — `StickyScrollWrapper`'s `overflow-auto` + `max-height` hides content when the browser paginates. Pre-existing since the feature shipped; nobody's used it. Not scoped into any arc slice. Fix would be a small polish slice adding `@media print { … }` (hide chrome / logout button / tab bar; force scroll containers to `overflow: visible; max-height: none`). Revisit after the arc if Print becomes a real accountant workflow.

---

## 8. Session log

- **2026-09-15 (S1)** — Consultant frame set. Confirmed 8-tab, 7-modal map against real code. Order locked small→large, deep dives, no-code. Guardrails written. Chunk 1 (Weekly) analysis complete: 3 slices identified (StickyScrollWrapper extract → optional generateReport lib extract → Weekly role extract). 6 traps flagged (T1–T6), none block production. Verified Weekly's derived vars are truly Weekly-scope (Consolidated/Timesheet-Only shadow with own locals) — makes the extract truly self-contained. Chunk 2 (Consolidated) analysis complete: 5 slices identified, headline finding is Slice 3 (Manager extract) copy-pasted `generateConsolidatedReport` instead of extracting to shared lib — corrective slice C3 unifies both. UX bug T7 found (stale "click Apply" copy at 7578) — fixed as commit `ce527f1` on main. Reusability lens directive from Dan codified in §2. Chunk 3 (Timesheet-Only) analysis complete: 4 slices, 2 more corrective/reuse wins (B2 MultiSelectDropdown, A4 TimesheetDayTable — the latter fixes the same copy-paste pattern in Manager + VendorManager). Chunk 4 (Client Estimation) analysis complete: bigger than initial estimate (~940 lines with modal). Dan chose Path B (prototype-parked) — 2 slices, ~3 hrs, encapsulate as-is. Missed ClientInvoiceModal at 14225 in initial modal inventory — correction saved to §4b. Chunk 5 (Payment Profiles) analysis complete: 4 slices, ~7-8 hrs. Two foundation atom slices PP1 (FilterPills, 7+ sites) + PP2 (AutocompletePicker, 4+ sites) pay off across the entire arc. PP3 (PaymentProfileModal cross-role, Accountant + VM + TimesheetUser) is compound with mandatory tests — bonus benefit drops VM's prop count. T28/T29 PaymentImport coupling aligned with Slice M0 spec for Chunk 9.

**Self-sufficient tab principle** added to §2 after Dan's Q. Retro-verified Chunks 1-5 slice designs — Chunks 1/2/3 revised so tab-local state moves INSIDE the tab file (not passed as props). Chunks 4 + 5 already compliant. Cumulative effect: Chunks 1-5 remove ~15 useState hooks + ~8 handlers from pre-role section of TS.tsx.

Chunk 6 (Invoices) analysis complete: biggest of the analyzed tabs (~739 lines JSX + 12 tab-local useState + 6 modals opened from here). 5-6 slices, ~9-10 hrs. Depends on PP1/T1 foundation atoms shipping first. I7 InvoiceDetail dual-role modal (accountant + TimesheetUser) deferred to Chunk 9 sweep. Corrective slice I3 extracts `useInvoiceFilters()` hook — the semantic un-scattering that both moves 12 states inside AND memoizes the filter cascade.

Chunk 7 (Payments) analysis complete: 755 lines + 15+ Payments-only state hooks + the Convera pipeline handlers it consumes. 5-6 slices, ~11-13 hrs. Critical trap T53 flagged as **highest-risk in the arc** — `handleProcess` (marks invoices paid + upserts convera_transaction_billpmts + advances batch state) has zero test coverage today; Chunk 10 must ship behavior-locking tests BEFORE extracting it. PL7 slice is the Chunk 10 handoff. T55 hard-coded $50 fee tolerance flagged for Dan's confirmation (intended or drift?).

Chunk 8 (QB Automation) analysis complete: 1,717 lines · 20+ QB state hooks · 11 render sections · [[qb-automation-ux-contract]] 6 immutable rules · **biggest chunk in arc, live daily**. 9 slices, ~18-20 hrs. QA8 UX contract snapshot tests are **HARD prerequisite** for QA9 tab extract — without them, the risk of silently violating UX rules 1 (counter) or 5 (month rollup ≠ filter) is unacceptable. QA1 `computeMissingBills` + QA2 `computeQbInboxGroups` extract business-critical pure logic to `src/lib/qbAutomation/` with tests (T60 + T58 remedy). QA9 target: `src/roles/Accountant/tabs/QbAutomation/` directory with hooks + 6 sub-components. Reusability: 5+ SortableHeader sites confirmed; AutocompletePicker reuse for vendor edit inside mapping widget.

Chunk 9 (Modals sweep + sequencing) analysis complete: rolled up all shared-atom + modal extractions from Chunks 1-8 into 5-phase global sequence. Phase 1 (foundation atoms — StickyScrollWrapper, MultiSelectDropdown, SourceBadge, StatusBadge, FilterPills base, AutocompletePicker, SortableHeader, CopyChip, FileUploadCard, resolveLivePaymentProfile) is ~10-12 hrs and unlocks everything downstream. Phase 4 (tab extracts + accountant modals) is ~48-55 hrs. Total arc estimate ~90-100 hrs excluding Chunk 10 (Convera handlers). 5 meta-traps flagged (T71-T75), notably T71 — PP1 FilterPills variant API needs designing before extraction, not retrofitting. D9.1-D9.6 cross-cutting decisions documented. Modal home rule: single-role → `src/roles/Accountant/modals/`, multi-role → `src/components/`.

Chunk 10 (Convera pipeline extraction) analysis complete: **highest-risk chunk in arc**. 11 slices across Phase 5A (test scaffolding + pure-fn extract), 5B (orchestrator tests), 5C (orchestrator extract + integrate + delete pre-role). ~30-35 hrs. **Tests-first is non-negotiable** per Dan 2026-09-01 caveat #4 + [[handle-process-no-tests]]. 15 pure fns + orchestrators inventoried. 10 invariants (INV1-INV10) must be locked before any code moves — INV1 (SYN+IBAN corroboration, Fat Struct guardrail), INV4 (umbrella grouping BY vendor), INV6 (live-profile fetch never trust snapshot), INV7 (matcher_ignore fence) are critical. 10 traps (T76-T85) flagged, notably T76 (`handleProcess` non-atomic) and T79 (`applyConveraPayments` may be dead code — verify first). ~2000 lines removed from TS.tsx pre-role when complete. Convera retrofit ([[convera-retrofit-reality]] W2/W3) is a SEPARATE arc, not part of Chunk 10.

Chunk 11 (Final synthesis) COMPLETE — arc analysis done. 50 slices catalogued across 5 execution phases with prereqs, effort, zero-regression checks, memory-save triggers. Headline: TS.tsx 15,871 → ~3,500-4,500 lines (-73%). ~130-150 hrs across 15-20 focused sessions (4-6 weeks calendar at 3-4 sessions/week). 7 gating open Qs identified (Q10.1 Vitest, Q9.3 PP1 API, Q9.4 TSU tests, Q10.2 dead code, Q7.2 fee tolerance, Q8.3 vendor mapping, Q10.3 atomic RPC). 23 consultant-default Qs proceed unless overridden. Success criteria: 8 tabs + hooks + lib/convera + api/convera + lib/qbAutomation + 10 shared atoms. Fail-safes: preview branch → eyeball → ff-merge per slice. All INV/UX/pure-fn extracts require tests before merge. **Living doc ready for execution starting S2.**

- **2026-09-16 (R1 — independent review, second model)** — Plan verified line-by-line against `ce527f1`. Written up as §1b (overrides §11b on conflict). Headlines: (1) pre-role handlers read/write the state the plan calls "tab-local" (T86) — Payments tab extract must follow V8, QB tab extract needs a new `src/api/qbAutomation/` slice (X4); (2) domain types must leave TS.tsx first (X0) — four Convera/QB types aren't even exported; (3) component-test scaffolding (jsdom + RTL) doesn't exist and is needed in Phase 2 (X1); (4) I7 is an ~818-line accountant modal, not a 3-hr mode-prop unify; (5) −73% headline needs Phase 6. Gating Qs Q10.1/Q10.2/Q2.2 answered by code. Four shipping bugs flagged in §1b-G — #1 (accountant profile modal never renders) needs Dan to click-confirm before PP3 is scoped. Added `.claude/scripts/state-consumer-map.py` as the mechanical gate for every state relocation (rule E1). Memory files [[qb-automation-ux-contract]] etc. were NOT readable from the review session (protected path) — Chunk 8/10 risk ratings were checked against `src/lib/qbWrite/INVARIANTS.md` and code only.
- **2026-09-16 (R1 addendum)** — Dan confirmed §1b-G bug #1 (accountant profile modal never opens). PP3 finalized as bug fix + extract, front of Phase 3. Phase 6 decision: 6-lite (X8 approval-path tests, ~6 hrs, before I6) now; full handler move deferred to the TSU arc with a go/no-go checkpoint after V11. Arc line-count target amended to ~6,000–6,500 (§11f).

- **2026-09-16 (S2 — execution start)** — 7 gating Qs resolved (Q7.2 lock $50 + follow-up; Q8.3 defer to QA9; Q9.3 extend PP1 retroactively; Q9.4 X1 in Phase 0; Q10.1 Vitest confirmed; Q10.2 watchpoint pattern for absent code; Q10.3 atomic RPC deferred to follow-up arc). **X0 shipped** to main as commit `1e84784`: `src/types.ts` (304 lines, all 27 domain types + type aliases, previously-unexported `ConveraBeneficiary`/`ConveraTransaction`/`ImportBatch`/`QbIngestEvent` now exported), `src/lib/countries.ts` (34 lines), TS.tsx 15,871 → 15,619 (−252 lines), 3 role-file couplings to TS.tsx removed. `tsc -b` + `npm run build` clean. 6 pre-existing test failures unchanged. Dan flagged general merge-scope hesitation → §2 gained "Merge timing & rollback discipline" subsection (4 risk tiers with named merge windows, rollback as first-class ops step, Claude runs zero-regression check on preview URL before Dan eyeball) + §1b-E E9. X0 classified as Trivial tier → merged same-hour. Session-end: X1 (jsdom + RTL scaffold) is the next slice.

- **2026-09-16 (S2 continued — Phase 1 + partial Phase 2 execution)** — Full Phase 1 (X1/X2/W1/T1/T2/A10/PP1/PP2/B4/B6/I4/X3) + Phase 2 tab-family cluster (C2/C3/C4/C5/W3) shipped in one session. **18 slices total, main advanced from 1e84784 → 7c79fba**, TS.tsx 15,619 → 14,994 (−625 in-session, −877 cumulative). Test suite: 14 → 416 passing. Non-obvious findings:
  - **X1 discovered:** `@testing-library/react` requires an explicit `afterEach(cleanup)` in `src/test/setup.ts` for each-test DOM cleanup; without it, multiple `render()` calls in the same describe accumulate DOM and cause "multiple element" errors. Fixed once in setup; benefits every future component test.
  - **T1 discovered:** `<input list="…">` gets accessibility role `combobox` not `textbox` (used in QbVendorNameEditor tests too).
  - **T1 z-40 canonical dropdown layer:** In-app tables use `sticky top-0 z-20` for headers and `sticky left-0 z-30` for frozen first columns. Dropdown panels need `z-40` to clear both, `z-50` reserved for modals. Codified in the MultiSelectDropdown component comment; applies to all future picker atoms.
  - **PP2 F2 cleanup:** `saveQbVendorName` no longer resets the tab-local edit state — the caller does it inside its `onSave` handler. `qbVendorEditValue` useState deleted from pre-role; `qbVendorEditingId` stays (outer "which row is editing" state consumed by 2 render paths).
  - **C3/C4 preserved T95:** double-application of `countryName` in the CSV byte-for-byte (idempotent for known countries; would break byte-diff if "cleaned up").
  - **C5 F15 deferred to W3:** the Consolidated tab could get `useMemo` too but the report was already only re-computed when its own state changed (unlike Weekly). Left as follow-up.
  - **W3 F15 applied:** `generateReport` wrapped in `useMemo([timesheets, users, projects, reportWeek])`. Prior to W3 the fn ran on every accountant render across every tab.
  - **W3 discipline slip caught:** committed W3 directly to main instead of a branch. Rewound with `git branch <slice-name>` + `git reset --hard <prev>` before pushing. Preview-branch discipline holds.
  - **Print button empty pages** (Weekly, likely Consolidated too): pre-existing; app has zero `@media print` rules. Logged in §7 as follow-up, not scoped into arc.
  - **Manager view has no live users** (Dan confirmed twice): C3 unified Accountant + Manager report computation but only Accountant needs the byte-diff eyeball. Speeds up future Consolidated-family slices.
  - **Bug #1 (accountant PP + New profile modal) re-surfaced** on preview — Dan confirmed it's the exact §1b-G #1 bug PP3 is designed to fix. Not scoped into any current slice.
- Session ended: 14,994 lines in TS.tsx, main tip `7c79fba`, next slice is **T3 (DayHourCells, §1b-C descoped: 3 consumers, tests-first)**.

- **2026-09-17 (S3 — Phase 2 close + PP3 + hotfix bundle)** — 4 arc slices + 3 hotfix commits. **Phase 2 closed** with T3 (`—`, DayHourCells) + T4 (Timesheet-Only tab) + CEP1 (dead-code) + CEP2 (Client Estimation folder). **PP3 shipped** `adb9c86` — PaymentProfileModal extract that also fixed accountant-branch bug #1 (modal was inert since `cb9501c` 2026-06-17). **Hotfix bundle** merged as `a8a9ab5`: (1) `tryResolveVendorForApproval` no longer opens QB vendor picker at approval time — just blocks when contractor has zero payment profiles; picker moved to push-time only. New rule [[encourage-dont-block]] codified. (2) `QbPushPreviewModal` bank routing switched from "WU Holding" → "8220 Key Point Checking" for Convera groups (mirrors writer fix `7d82dfc`). (3) `VendorDecisionModal` z-index bumped z-50 → z-[60] for modal-over-modal stacking. TS.tsx 14,994 → 13,674 (−1,320 in S3). New arc-state memory `project_accountant_modularization_s3.md`.

- **2026-09-17 PM (S4 — Phase 3 close + Phase 4 start)** — **8 slices shipped in one session.** FUC (`f745cd9`) → M0 (`fa20a1d`) → A11 (`4266c56`) → A9 (`d462fb8`) → X8 (`8bf3521`) → PP4 (`c4ca071`) → I1 (`bedc49c`) → I2 (`7d66426`) → I3 (`ca1ab0a`). **Phase 3 CLOSED** (M0 = substantive close). X8 = test-only behavior lock (20 tests). Phase 4 progress: PP4 (Payment Profiles tab) + I1 (MultiSelectDropdown at contractor picker) + I2 (FilterPills extended + 5 pill rows) + I3 (useInvoiceFilters hook with 12 memoized outputs). Also created STOP GATE in memory ([[qb-automation-stop-gate]]) + plan (§1b-C bullet + Chunk 8 header) so future sessions pause before X4/QA7/QA8/QA9. TS.tsx 13,674 → 13,048 (−626 in S4, **−2,823 arc cumulative, −17.8%**). Test suite: 435 → 491 (+56 in S4). Main tip `ca1ab0a`. Next slice: **I5 (optional InvoiceReconBadge, ~45 min) OR I6 (Invoices tab extract, ~3h)**. Then X5/X6/CB, IB, then 🛑 QB Automation discussion with Dan before X4/QA7/QA8/QA9. Also created [[git-add-specific-files]] feedback memory after Push Protection block during FUC.

- **2026-09-17 EOD (S5 — Invoice cluster close)** — **1 slice shipped; I5 skipped per gate.** I6 (`596d696`) — Invoices tab extract to `src/roles/Accountant/tabs/Invoices.tsx` + `InvoiceReconBadge` extract + `reconcileInvoiceLive` moved to `src/lib/reconcileInvoice.ts`. I5 gate outcome: modal renders a full recon section (title bar + summary + week rows table), not a compact badge; row + group-header sites DO share badge shape and were dedup-ed inside I6. Standalone I5 skipped. **Largest single-slice delta of the arc: −692 lines.** TS.tsx 13,048 → 12,356 (**−3,515 arc cumulative, −22.1%**). Test suite: 491 → 502 (+11 InvoiceReconBadge). Main tip `596d696`. **Invoice cluster CLOSED** (I1/I2/I3/I6). Non-obvious carries: (1) wrapper collapsed to `const invoiceFilters = useInvoiceFilters(...); <InvoicesTab {...invoiceFilters} .../>` — spread pattern replaced 15-field destructure; (2) row-click 2-call form intentionally preserved (§1b-C X3 comment) — reset-effect at wrapper handles pending* clear on `selectedInvoice.id` change; (3) E4 tab-effect count didn't drop because I3 had already migrated the tab-guarded month-preset effect — no residual to migrate; (4) group-status literal renamed `'unknown'` → `'unverifiable'` to match `reconcileInvoiceLive` return type (no rendered output change). Next: **I7 (accountant InvoiceDetailModal extract, 6–8h, High risk, tests-first per E6) OR X5+X6 (Convera batch file tests + extract, ~5–6h) OR X7 (IIF builders lib, ~3h)**. Then CB, IB, then 🛑 QB Automation talk before X4/QA7/QA8/QA9.

- **2026-09-18 (S6 — X7 IIF deletion)** — **1 slice shipped: X7 amended from extract to deletion.** Dan flagged IIF export as deprecated (fully superseded by qbXML QB Automation Layer) and preferred delete-with-archive over extract-with-tests. X7 (`bee1c43`) deleted `buildIifContent`, `buildPaymentIifPreview`, `buildPaymentIifContent`, `bulkMarkInvoiceExportStatus`, `bulkMarkPaymentExportStatus`, `paymentIifPreview` hook + PaymentIif* types, Generate IIF footer button + stale "Chunk 2a" hint (QbExport modal), Export Payments IIF batch button (Payments tab), and the entire Payment IIF preview modal (146 lines JSX). Full source archived at `.claude/archive/deprecated-2026-09-iif-export.md` per [[archive-deleted-code]] with restore recipe. **QbExport modal itself RETAINED** — its category-card status inspector (Ready / No vendor / Already sent / Skipped / Confirmed) + Skip/Unskip/Confirm per-row actions + `saveInvoiceExportStatus` all still work. Dan noted 2026-09-18 that the retained QbExport surface may factor into QB Automation UX improvements at the STOP gate — carry-in item added to [[qb-automation-stop-gate]] memory. **−496 lines TS.tsx (12,356 → 11,860, cumulative arc −4,011 / −25.3%).** Build clean; 502 pass / 6 pre-existing fail. Downstream QE/PI dependencies on X7 IIF now need re-scope (both moot under qbXML flow — decide when we reach them). Also created [[feedback_preview_check_instructions]] rule: every slice-close summary must include a short "What to check on preview" bullet list. Next: **I7 (accountant InvoiceDetailModal extract, ~6–8h, High risk, tests-first per E6)** per Dan's earlier "then take the biggest piece I7, right?"

- **2026-09-18 EOD (S6 — I7 InvoiceDetailModal extract)** — **1 slice shipped, High risk, merged with Dan's preview eyeball.** I7 (`3b57336`) — extracted the 818-line accountant InvoiceDetailModal to `src/roles/Accountant/modals/InvoiceDetailModal.tsx` (~630 lines) + `calculatePayOn` → `src/lib/invoiceDates.ts`. Moved with it: 16 tab-local hooks (plan said 18; actual 16 after grep) + reset effect on `inv.id` change. Wrapper kept: `selectedInvoice`, `showInvoiceModal` (shared with TSU T98), `beneficiaryOverrideProfileId`/`Search` (shared with PP tab), `attachmentUploading` (shared with TSU). 13 handlers threaded as props (`handleInvoiceAction`, `saveInvoiceEdits`, `savePeriodEdit`, `saveValueEdit`, `applyUsdRate`, `previewPeriodChange`, `handleAttachmentUploadForExisting`, `deletePaymentProfile`, `loadConveraBeneficiaries`, `openAttachment`, `switchInvoicePaymentProfile`, `setConveraOverride`, `paymentMethod`). **Design nuance shipped: [[modal-owner-callback-pattern]] I7 addendum** — 5 pre-role handlers (`applyUsdRate`, `handleInvoiceAction`, `savePeriodEdit`, `saveValueEdit`, `openInvoiceDetail`) had trailing `setPendingX('')`/`setXEditOpen(false)` lines that were **DELETED**, not preserved via narrow callbacks. The modal wraps handler calls in its own onClick and performs local resets there. Rule: when state ownership moves to a child, the setters die at the old owner; child takes local responsibility for lifecycle. **+14 render tests** (submitted/approved/paid/rejected action buttons, preview gates for period + value edits, USD-rate visibility gate, multi-line value-edit warning, backdrop close, form-reset-on-save round trip). Debug map saved at `[[invoice-detail-modal-i7]]` — READ FIRST if accountant reports invoice-modal bug. **−865 lines TS.tsx (11,860 → 10,995, cumulative arc −4,876 / −30.7%).** Build clean; 516 passing (+14) / 6 pre-existing fails unchanged. Next: X5+X6 (Convera batch file tests + extract, ~5–6h, preps CB). Then CB, IB, then 🛑 STOP GATE (QB Automation talk with Dan) before X4/QA7/QA8/QA9.

- **2026-09-18 EOD+ (S6 — X5+X6 Convera batch file extract, partial)** — **1 slice shipped, Medium risk.** X5+X6 (`7f20e44`) — extracted the Convera CSV builder half to `src/lib/convera/batchFile.ts` with 34 behavior-lock tests. Extracted: `csvEscape`, `fmtConveraAmount`, `buildConveraBatchRows`, `buildConveraBatchCsv`, `computeConveraBatchFilename` + 4 types + 6 constants. `downloadConveraBatchCSV` in TS.tsx shrinks 73 → 10 lines (thin wrapper). Tests encode Ale's Convera format contract: CRLF (not LF) / no BOM / no trailing newline / integer amounts for whole dollars, .XX for cents / 100-char cap on beneName + ref1 / TEAL umbrella shared-Ref1 rule / India Ref2 (`PURPOSE OF FUNDS P0802`) both from group.anyIndia + manual row country='India' / POP always 'Trade Related' / manual rows appended after group rows / empty rows → header-only CSV. **X6 partial:** `openConveraBatchPreview` grouping / deprecated-bene redirect chain / skip-classifier / IBAN-country map NOT extracted — heavy DB + state calls, deferred until CB reaches inside for pure helpers. **CB is now half-gated:** CSV builder safe to consume from extracted CB modal; preview grouping still at wrapper. Documented at [[convera-batch-file-extract]]. **−67 lines TS.tsx (10,995 → 10,928, cumulative arc −4,943 / −31.1%).** Build clean; 550 passing (+34) / 6 pre-existing fails unchanged. Next: CB (Convera Batch modal extract), IB (Intuit Batch modal extract), then 🛑 STOP GATE (QB Automation talk with Dan) before X4/QA7/QA8/QA9.

- **2026-09-18 EOD++ (S6 — CB Convera Batch modal extract)** — **1 slice shipped, Medium risk.** CB (`89f6dfa`) — extracted the 352-line Convera Batch modal JSX to `src/roles/Accountant/modals/ConveraBatchModal.tsx` (~350 lines). Pure render + drilled state per compound-temporary-state pattern ([[modal-owner-callback-pattern]] M0/PP4/PP3 precedent). All 7 state hooks stay at wrapper (E1: cross-consumed with `openConveraBatchPreview` + `downloadConveraBatchCSV`): `showConveraBatchModal`, `converaBatchGroups`, `converaBatchCombine`, `converaBatchSkipped`, `converaBatchExcluded`, `converaBatchManualRows`, `converaBatchManualEditor`. Modal receives state + setters + `onDownload` + `copyIntuitField` helper as props. Types `ConveraBatchSkip`, `ConveraBatchExcluded`, `ConveraBatchManualEditor` live in the modal file; `ConveraBatchGroup`/`ConveraBatchManualRow` imported from lib. **Bonus lib extract:** `sanitizeIban`, `transliterateAscii`, `ibanChecksumValid`, `checkIbanLength` (+ `IBAN_LENGTH_BY_COUNTRY`) lifted from TS.tsx module-level to `src/lib/iban.ts` — extracted modal shouldn't import from TS.tsx per [[self-sufficient-tab]]. TS.tsx re-imports from lib. CSV output invariant (X5+X6 tests still lock the file format). **−389 lines TS.tsx (10,928 → 10,539, cumulative arc −5,332 / −33.6%).** Build clean; 550 passing / 6 pre-existing fails unchanged. Next: IB (Intuit Batch modal extract, ~2h Medium risk), then 🛑 STOP GATE (QB Automation talk with Dan) before X4/QA7/QA8/QA9.

- **2026-09-18 EOD+++ (S6 — IB Intuit Batch modal extract → STOP GATE)** — **1 slice shipped, Medium risk. Arc hits STOP GATE.** IB (`801b080`) — extracted the 115-line Intuit Batch modal JSX to `src/roles/Accountant/modals/IntuitBatchModal.tsx` (~130 lines, 5 props). All 3 state hooks stay at wrapper (E1: `showIntuitBatchModal` + `intuitBatchInvoices` set by `openIntuitBatchPreview` pre-role; `copiedIntuitField` cross-consumed with CB modal for shared copy-chip active-indicator state). No new tests — pure render, no logic. Plan §1b-C mentioned "IB1 kpiExpanded + IB2 sortKey/direction hooks" — stale plan text, those hooks don't exist. Actual modal is simpler than described (Print + Close + copy-chip table). **Bonus cleanup:** `Printer` + `Copy` lucide-react icon imports + `CopyChip` component import removed from TS.tsx — last consumers were CB (CopyChip) + IB (Printer + Copy title icon + CopyChip). **−108 lines TS.tsx (10,539 → 10,431, cumulative arc −5,440 / −34.3%).** Build clean; 550 passing / 6 pre-existing fails unchanged. **🛑 STOP GATE reached** — QB Automation tab discussion with Dan REQUIRED before scoping X4/QA7/QA8/QA9 per [[qb-automation-stop-gate]]. Carry-in for the talk: QbExport modal retained after X7 IIF deletion (category-card status inspector + Skip/Unskip/Confirm + `saveInvoiceExportStatus` all still work) may factor into QB Automation UX redesign — Dan flagged 2026-09-18 that the retained surface should factor into the discussion. Also QE/PI dependencies on the deleted X7 IIF need re-scope (both moot under qbXML flow — decide when we reach them post-gate).
