# Changelog — Synergie Timesheet System

> Last brought current 2026-08-11. Focuses on WHY, not just what. Commit hashes included where available.
> Recent sections are lighter than early ones — for deep detail on any theme, follow the memory-file links in each section.

---

## 2026-08-11 — No Silent Drops + Zero-Hour Accept & Confirm Loop

**Commits:** `a8e76ae`, merge `c26fb4b` — hotfix branch `hotfix/silent-drops-and-zero-hour-loop`

**Trigger:** Zejd Koco submitted a legitimate zero-hour PDF (LOA week 8/3–8/9). Claude vision correctly read all zeros, but the poller's all-zero rejection guard (built to filter Claude misreads) silently dropped the email — no log entry, contractor got no acknowledgement, admin had no visibility.

**Three parts shipped:**

1. **Every email now produces a log entry.** Three sentinel paths in `poller.js` (unknown PDF type, XLSX parse failure, Claude gave up) previously returned without any DB write. Each now POSTs `logOnly: true` with a distinct `parseStatus` — `unknown_pdf_type`, `xlsx_parse_failed`, `parser_no_extract`. The existing `logOnly` handler in `ingest-timesheet` was extended to accept a caller-supplied `parseStatus` (previously hardcoded to `'failed'`). Two additional statuses renamed out of the generic `failed` bucket: `unsupported_file_type` (attachment ext not xlsx/pdf/docx) and `auto_yes_zero_blocked` (sanity gate refusal). See `docs/edge-functions.md` for the full status vocabulary table.

2. **Zero-hour direct submissions are accepted.** `claudeExtractTimesheet` no longer rejects all-zero output if Claude also returned a valid `weekStart` and `contractorName` — that combination signals a real submission (LOA/PTO/sick). Ingest splits the old `success_zero` status into `success_zero_hours` (direct — sends a Brevo confirmation email asking the contractor to reply with a correction if wrong; Reply-To routes back into the poller) and `success_zero_hours_forwarded` (accountant-forwarded — auto-sets `timesheets.verified_zero_hours=true`, no email). `DONE_STATUSES` was extended so a re-attempted zero-hour message doesn't fire a second confirmation email.

3. **Portal 0-hour submission guard.** `submitTimesheet` in `TimesheetSystem.tsx` computes total hours before insert; if 0, shows a `window.confirm` dialog citing common reasons (PTO/LOA/sick) and requiring explicit confirmation.

Zejd's specific week was inserted manually as `timesheets.id=1480`, `verified_zero_hours=true`, note "Contractor confirmed LOA".

---

## 2026-07 to 2026-08 — Major initiatives (thematic summary)

The July stretch was the busiest shipping period since launch. Rather than 200+ commit entries, this section maps memory files to the initiative they document. Each memory file has the full context.

### Payments Tab (July 1–13)
Full round-trip payment pipeline: Convera Batch CSV export + Payments tab CSV import + auto-matcher.
- **Matcher redesign** (2026-06-30, `9d5080d`) — 5-level beneficiary-ID-first sequence; "weak" badge for level ≥ 3; 15-day proximity window on payOnDate. Detail: [[project_payment_matching_logic]].
- **Payments Tab MVP** (`c988935`, `dcd44d3`, `ae62668`) — `matcher_ignore` fences on invoices + convera_transactions, asymmetric date windows, two-pool matcher, re-import dedup, umbrella-group multi-select. Detail: [[project_payments_tab_mvp]] and [[project_payments_backlog]].
- **Convera Batch Upload** (`ff4474e`, `987c673`, `86877dc`) — CSV CRLF, shared invoice-number for umbrella groups, beneficiary directory with filter pills + sortable columns + manual batch rows. Country enforced from IBAN. Detail: [[project_convera_batch_upload]] and [[project_convera_beneficiary_names]] (cp1250 sniff shipped for encoded names).

### Client Invoicing (July 2–21)
End-to-end client invoice generation, edit, and print flow.
- **MVP-A** (2026-07-02, `648cbf4`) — Export + import round-trip; blue cells for hour overrides. `hour_overrides` table exists in DB but has no migration file (GOTCHA). Detail: [[project_client_invoicing]].
- **MVP-B Phase 1** (`ff48d26`, `84c4bb8`) — Printable invoice modal; SLO tweak on `poller_heartbeat` (require 2 consecutive breaches). Detail: [[project_session_2026_07_17]].
- **Print CSS overhaul** (`b4b8c7e`, `29daeb3`, `0682a05`, `e8b2dbf`, `0702f5b`) — Modern accent-bar visual redesign; print isolation via data-attribute portal; page-counter footer with invoice ref; multi-page hygiene. Detail: [[project_session_2026_07_21]].
- **Invoice status reversibility** (2026-07-10) — Accountant can Re-approve rejected or Reject approved invoices; locked once `paid_date` set. Detail: [[project_invoice_status_reversibility]].
- **Invoice period edit** (2026-07-28, `6e3e753`, `e45a3a3`) — Accountant edits period from modal with preview + reason gate + collision detection + auto pay-on-date recompute on terms change. Detail: [[project_invoice_period_edit]].

### QuickBooks Exports (July 8–23)
- **QuickBooks IIF Phase 3** (2026-07-08, `2e94d68`) — Modal + Generate IIF + per-row Confirm. Detail: [[project_quickbooks_iif_export]].
- **QB Payments IIF** (2026-07-22, `f0564c0`, `37b85d3`, `27fb92b`, `4ccf272`) — Per-batch button on Payments tab; CHECK not BILLPMT (QBO restriction — no BILLPMT type, no auto-apply); grouping by confirmation number; honest fee memo; DOCNUM = wire confirmation to survive IIF's 11-char limit. Detail: [[project_qb_payment_iif_export]] and [[project_session_2026_07_22]].
- **QB integration direction locked** (2026-07-23) — Path A (DIY qbXML Web Connector, query-then-apply, move bills too) chosen over Path B. Iterative async build while Dan travels. Detail: [[project_qb_web_connector_design]] and [[project_qb_integration_direction]]. Chunks 2, 3, 4·Session 1 committed on branch `qb-web-connector-chunk2-builders` (74 tests). Not yet live.

### Anomaly Detector & Guardrails (Aug 6–10)
- **Invoice anomaly detector** (2026-08-06, deployed; committed 2026-08-10 as `54824b2` + `5d0662c`) — Post-parse deterministic rulebook in `ingest-invoice`. 107/109 clean run; 2 legit flags. Catches Juran/Zlatar/Nikolina originals. Detail: [[project_invoice_anomaly_detector]].
- **Bimosoft UK ALT rule** (2026-08-10, `5a3b585`→`54cde1d`) — Beneficiary deprecation guardrail: all Bimosoft invoices must link to UK ALT profile. Legacy linkages caused two contractors' payments to go astray. `force_combine` flag added for umbrella beneficiaries. Detail: [[project_bimosoft_uk_alt]] and [[project_session_2026_08_10]].
- **DOCX invoice pipeline** (2026-08-10, `e3fb22d`) — Text-only extraction; skips vision paths.
- **Admin create-user fields** (2026-08-10, `b5151d6`, `67572ce`) — Persist `payment_terms` + `location_type`; default `invoice_enabled=false`. Follows the create-vs-edit-path split rule ([[feedback_create_edit_path_split]]).

### SLO Alerting (2026-06-22)
`monitor-health` edge fn + `system_alerts_state` table + pg_cron job 8 (`:47`). 5 Tier 1 SLOs, all verified via `?dry_run=true`. Detail: [[project_slo_alerting]].

### Timesheet Locking (2026-07-08)
`locked_days[]` on timesheets; set on invoice approval; hard-rejects re-submissions to accountant email. **Silent bypass bug fixed** (`2847e9a`) — `locked_days` is `timestamptz[]` but was compared to date strings; every lock had been theater since ship. Damir 552 only definitive victim. Detail: [[project_timesheet_locking]].

### Digest Redesign (Jul 17)
`d5591845`, `28c6191` — SVG trend chart wrapped in data-URI img for Apple Mail; trimmed table; contractor movement panel. Detail: [[project_session_2026_07_17]].

### GNW Offshore Rate Correction (Jul 24)
GNW offshore = `bill_rate − $20/hr` practical. Org `$65` seed was applied to raw rates → 27 GNW mis-seeded onshore. Corrected 2026-07-24 with `$85` threshold. Detail: [[project_gnw_offshore_rate_discount]].

### Poller Heartbeat + Age Gate (Jul)
- `system_settings.poller_last_run` stores JSON `{ran_at, run_id, counts}`.
- `run_id` indexed on `email_import_log` for per-run drill-down.
- `send-reminder` defers at hours 9–10 if poller age > 45 min, fires anyway at 11 (safety fallback).
- **7-day age gate on UNSEEN IMAP search** (`d9bc308`) — filters phantom re-fetches. Detail: [[project_poller_heartbeat]].

---

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
