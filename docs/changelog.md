# Changelog — Synergie Timesheet System

> Generated 2026-06-12 from git log and memory files. Focuses on WHY, not just what. Commit hashes included where available.

---

## 2026-06-13/14 — Invoice Filter Overhaul, Submission Channel Cards, NaN Fix

**Commits:** `e6147f4`, `23fd4fa`, `02f754a`, `d8f3d0d`, `4ff7bed`

### Invoice tab UI overhaul

The filters panel was moved above the KPI cards so filters are always visible when scanning totals. KPI cards now derive from the **filtered** invoice set rather than the global `invoices` array, so the numbers always reflect what is on screen.

Two key filter interactions were also fixed:

- **Status pill counts** use `preStatusFiltered` (all active filters except status) so switching between status tabs shows meaningful counts rather than collapsing to 0.
- **Pay On Date quick-select pills** are dynamically built from distinct `payOnDate` values present in the DB. An explicit "Not assigned" pill covers invoices with no pay date. These pills react to all other active filters (month, contractor, etc.) — built from `prePayOnFiltered`. Auto-default to the latest month is applied when invoices first load via a `useEffect` on `invoices.length`, with a "Loaded to latest period" hint shown next to the month pills.

**Filter pipeline order:** `prePayOnFiltered` (no pay-on filter) → `preStatusFiltered` (adds pay-on, no status) → `filtered` (adds status). New state variable: `invoicePayOnPreset: string` (`''` = all, `'none'` = not assigned, `'YYYY-MM-DD'` = specific date).

### NaN fix in consolidated reports

`parseFloat` returns `NaN` for a truthy non-numeric string (e.g. `'null'` from a DB entry). This poisoned the `grandTotal` reduce in both the accountant and manager consolidated report generators. Fix: `parseFloat((entry as TimeEntry)?.hours || '0') || 0` — the trailing `|| 0` clamps `NaN` to 0. Applied at accountant line ~4119 and manager line ~3439.

### Submission Channels KPI card — weekly view

A 4th KPI card added to the accountant weekly view. Shows Portal count (`source === 'direct'`), Email count (`source === 'imported'`), percentage split, and a progress bar. Derived from `reportData` (already available — no extra fetch). Weekly KPI grid changed from `md:grid-cols-3` to `md:grid-cols-4`.

### Submission Channels KPI card — consolidated tab

`ConsolidatedTable` extended with an optional `sourceCounts?: { portal: number; email: number }` prop. When supplied, a 5th KPI card is rendered (grid becomes `md:grid-cols-5`). `generateConsolidatedReport` computes `sourceCounts` from the in-range timesheets after test-account exclusion. Manager view passes no `sourceCounts` — the prop is optional so manager behaviour is unchanged.

---

## 2026-06-11 — Phase A AI Agent: Live

**Commits:** `3da1312`, `a11b37c`, `68f00f4`, `8890290`, `38406cb`, `dda7304`, `4ff6bb1`, `503b163`, `a433b8a`, `5706dbe`, `c16b819`

The AI agent Phase A was built, merged, and immediately had 4 critical bugs fixed before a real-world run occurred.

**What was built:**
- `send-reminder`: Friday emails now detect consistent submitters (±4h, 3+ weeks, non-portal-only) and offer "Reply YES to submit same hours" as option 1
- `send-reminder`: Portal-only submitters suppressed from reply CTA (they should use the portal)
- `send-reminder`: Subject includes week ending date for reply matching
- `send-reminder`: `dry_run`, `test_to`, `test_user` params for isolated testing
- Poller: Groq classifier (`llama-3.3-70b-versatile`) routes YES → auto-submit, MODIFY → pending, NO → drop
- Poller: `reply_yes_pending_{userId}` flag in `system_settings` suppresses Monday reminders for 72h after YES (belt-and-suspenders)
- `send-timesheet-report`: `auto_yes` channel classification for `message_id LIKE 'reply-yes-%'`

**Bugs found and fixed post-merge:**

1. Classifier dead code (`4ff6bb1`): The `!hasTimesheetContent` else block forwarded to helpdesk with `continue` before the classifier ran. Every YES reply was forwarded to helpdesk. Fix: reorder branches.

2. `fetchLastApprovedEntries` using anon key (`a433b8a`): RLS silently returned `[]`, so fetchLastApprovedEntries returned null for all contractors. Auto-submit never fired. Fix: use `supabaseServiceKey`.

3. `sendSummaryEmail` crash on reply reports (`503b163`): `timesheetReports` entries from classifier had wrong field names for `.padEnd()`. Fix: standardise on `action`, `contractorName`, `week`, `attachmentName`, `notes`.

4. `timesheetReports.length` missing from actionable count (`c16b819`): `actionable` sum at end of `main()` didn't include reply results. Summary email and timesheet report never fired for YES-only runs. Fix: add to sum.

---

## 2026-06-12 — from_email bug fix in email_import_log

`ingest-timesheet` was always setting `from_email = contractorEmail` regardless of whether the email was forwarded. This masked forwarded submissions — `from_email` and `resolved_email` were identical even when they shouldn't be. Fixed: `from_email = forwardedBy || contractorEmail`. This makes channel classification in `send-timesheet-report` reliable (forwarded = `from_email != resolved_email`).

---

## 2026-06-10 — Payment Terms + Invoice Profile Switch

**Commits:** `87615c5`, `793e249`, `1e17ff0`

**Payment terms:** NET15/30/45/60 on `profiles` and `invoices`. Pay On Date calculation: `period_end + N days` → nearest 15th/EOM → weekday adjustment. Cascade: changing terms on an invoice also writes to `profiles.payment_terms` so future invoices pre-populate. 14 contractors seeded from historical payment history.

**Invoice profile switch:** Accountant can switch/assign payment profiles on existing invoices. `invoices.payment_profile` stores a full JSON snapshot — switching replaces it. Needed because contractors occasionally submit with the wrong profile.

---

## 2026-06-08 — Invoice Layer 1 Dedup + Parser Fixes

**Commit:** `89c4afa`, plus several parser fix commits

Invoice dedup: skip Claude if message_id already processed (`email_invoice_log` lookup). June baseline: 75% Claude hit rate before this fix.

---

## 2026-06-08 — Portal CSV Support

**Commits:** `82468e6`, `d466544`

Contractors can export their timesheets from the portal (`timesheets_export_*.csv`) and email them. The poller now parses this format.

**SheetJS `cellDates:true` trap:** When SheetJS parses CSVs with `cellDates:true`, date strings like "5/25/2026" become JS Date objects. `String(new Date(...))` produces "Mon May 25 2026…", breaking date parsing. Fix: `instanceof Date` check before regex.

---

## 2026-06-05 — DOCX Invoices + Intuit Resolution

**Commits:** `2c2d65c`, `909b3ea`, `a718dd8`, `7de6ddd`

DOCX invoices (Slaven Konforta, Nikolina Radošević) were silently dropped. Added DOCX support: `adm-zip` unzips, reads `word/document.xml`, concatenates `<w:t>` elements without separators.

**DOCX false-match bug fixed (`909b3ea`):** Naive XML parsing produced space-split numbers (e.g., `1h @ $5 = $5` for `168h @ $35 = $5,880`). Math cross-validation passed and Claude was never called — wrong data entered DB silently. Fix: concatenate `<w:t>` content without spaces.

Intuit/QuickBooks notification resolution added: contractor name extracted from first attachment filename → `find_profile_by_first_name` RPC.

Subject-name fallback for forwarded invoices with no body email: `find_profiles_by_name_words` RPC (SECURITY DEFINER required — anon key + direct profiles table is RLS-blocked).

---

## 2026-06-03/04 — Convera Integration

**Commits:** `3a542f6`, `e302088`, `55b72aa`, `4ad6c60` (approx)

73 payment_profiles imported for 56 contractors from Convera beneficiaries export. `convera_beneficiaries` and `convera_transactions` tables created. Convera Matching modal in accountant Invoices tab shows beneficiary audit table, default highlighting, and last-used payment date.

Critical findings: LT Revolut IBAN shared by 24 contractors, IE Revolut shared by 9. These cannot be matched by IBAN alone.

---

## 2026-06-02 — pg_cron Poller Trigger

**Commit:** `6c87f36`

GitHub Actions scheduled cron was lagging 3–28 hours. Replaced with: pg_cron → `trigger-poller` edge function → GitHub `workflow_dispatch`. The schedule trigger in `poll-timesheets.yml` was disabled (only `workflow_dispatch` remains). True hourly execution without re-architecting.

Magic link expiry updated to 24 hours via Management API (was 1 hour — too short for invite chain).

---

## 2026-06-01 — Invoice Pipeline Goes Live

Invoice ingestion pipeline deployed:
- `ingest-invoice` edge function deployed with forwarder-only gate and no auto-create
- `INVOICE_INGEST_ENABLED=true` in workflow
- `invoice-attachments` storage bucket confirmed
- `sendInvoiceAccountingEmail()` built — sends to accounting@ after each run

**Key design:** Forwarder-only gate preserves human checkpoint. Invoices land as `submitted` (never auto-approved). Reconciliation computed at insert time AND live in UI.

Brevo delivery issue resolved: the `status: null` entries in Brevo logs were caused by the Friday spam overload exhausting the 300/day free plan limit (from the pg_net burst incident on 2026-05-29), not an Exchange block.

---

## 2026-05-29 — Reminder Spam Incident and Three-Layer Fix

**Commits:** `3ace481`, `ef7aca3`, `74fe19a` + pg_cron update

**Incident:** Kornelije Sajler received 47 duplicate reminder emails. Root cause: pg_net background worker accumulated requests during a pause, then flushed all 47 simultaneously.

**Three-layer fix:**
1. pg_cron command now runs `DELETE FROM net.http_request_queue WHERE url LIKE '%send-reminder%'` before the `net.http_post`. Clears stale queue at source.
2. Invocation lock: atomic INSERT into `system_settings` with key `reminder_invocation_lock_{YYYYMMDDHH}`. First concurrent call wins; others return immediately.
3. Per-user atomic daily claim: INSERT on `system_settings` with key `reminder_user_{YYYYMMDD}_{userId}` before each send. Unique-violation = already sent today → skip. Replaced a prior JSON array approach that had a race condition.

---

## 2026-05-29 — Mid-week Start Date Bug Fixed

**Commits:** `96811ab`, `8d8d957`

All three report functions (`generateReport`, `generateMgrReport`, `generateConsolidatedReport`) filtered contractors with `startDate <= weekKey` where `weekKey` = Monday. Contractors starting Tue–Fri were excluded from their first partial week. Fixed: compare `startDate <= weekSunday` (Monday + 6 days) instead.

Example: Vladimir Simsic started 2026-05-22 (Friday) — had a portal timesheet for week of 2026-05-18 but didn't appear in any report until the fix.

---

## 2026-05-27 — Poller Heartbeat + run_id

`system_settings.poller_last_run` introduced. Stores JSON `{ran_at, run_id, counts}`. `run_id` indexed on `email_import_log` for per-run drill-down. `send-reminder` reads the heartbeat to defer 9am reminders if poller is stale (>45 min since last run).

**git add incident (same day):** `git add -A` accidentally included secrets and contractor PDFs. Required `git reset` and `.gitignore` fixes. Policy: always stage files explicitly by name.

---

## 2026-05-26 — Poller Crash Fix

**Commit:** `50e0daf`

`failedUids` and `successUids` were undeclared — dead code from an old manual mark-seen implementation. `markSeen: true` on IMAP fetch is the authoritative mark-seen mechanism. The uid arrays were removed.

---

## 2026-05-25 — Timesheet Report Email Simplified

Email body changed to show missing contractor names as chips only (no submitted rows in the body). CSVs still attached with full detail. Reason: 60+ user volume made the body unreadably long.

---

## 2026-05-24 — Approval Workflow + Auth Hardening

**Auth hardening:**
- Public signups disabled (`disable_signup: true` via Management API)
- `ingest-timesheet` hardened: `findOrCreateUser` → `findUser`. Unknown contractors rejected at function level (Layer 2), not just at poller level (Layer 1)
- New `create-user` edge function for admin-only user creation
- Tab-switch modal reload bug fixed: `loadedUserIdRef.current` was not set in the `getSession` path, causing the auth guard to miss tab focus token refreshes and reset modal state

**Approval workflow:**
- No manager assigned → auto-approved with `approved_by: 'self-submit'`
- Manager assigned → `pending` flow as before
- Accountant can approve/reject from Timesheet Only tab
- 7 legacy pending portal timesheets backfilled to `approved` for users without managers

**Source indicators:** Country column replaced by Portal (green) / Email (indigo) pills in all timesheet tables and CSV exports.

**Project display fixed:** All views now fall back to `user.projectId` from profile when timesheet has no `project_id` (email-imported timesheets never had project_id set).

---

## 2026-05-22 — Portal Launch

Launch email sent to all ~65 contractors. Portal adoption went from 0% to 47% portal submissions over the next 5 weeks. Median days-to-submit dropped from 11.8 days to 0.8 days.

---

## 2026-05-18 — Internal Forwarder Override Rule

**Commits:** `c145340`, related

Correction rule changed: internal forwarder (lpinto@, accounting@, etc.) sending a timesheet for a contractor who already has a `source='direct'` portal submission now **replaces entries outright** (not max-merge) and auto-approves. Reason: accountants may need to reduce hours (max-merge would ignore the reduction).

---

## 2026-05-13 — Poller State Cleanup

Multiple bad records cleaned up. Email import log dedup trap identified: `correction_pending` status blocks reprocessing — delete bad entries and insert manually if needed.

13 emails still unseen at this point (Claude fallback acting as safety net). Invoice poller not yet built.

---

## Early History (pre-May 2026)

The system was built as a Synergie internal tool. Initial state: all timesheets submitted by email only, parsed by a basic XLSX parser, ingested manually or via early poller. The portal was not yet launched.

Key early decisions preserved in code:
- Supabase Auth with sessionStorage (tab-isolated sessions)
- Week keys always Monday-based, display as "W/E Sunday"
- Holiday data hardcoded in frontend (US, GB, CA, HR, RS, BA, SI, MK) for 2026
- Contractor start/end dates bounding all report views
- Role-based rendering: entirely different UI per role in one monolithic component
