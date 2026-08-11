# System Overview — Synergie Timesheet Management System

> Last brought current 2026-08-11.

---

## What This Product Does

Synergie is a staffing/contracting company. This system manages:

1. **Timesheet collection** from ~65 contractors across the US, UK, Canada, and Eastern Europe — via a web portal or email attachment
2. **Invoice ingestion** — contractors send invoices to accounting; accounting forwards into the system after validation
3. **Manager approval workflow** — contractors submit, managers approve, accountants see consolidated views
4. **Client invoicing** — generate & print client-facing invoices from approved contractor hours (MVP-B live since July 2026)
5. **Payment reconciliation** — invoices auto-matched against Convera payment transactions; Convera batch CSV export for outbound payments
6. **QuickBooks integration** — IIF exports for bills and payments (QBO/QBD compatible)
7. **Automated reminders + deterministic YES-reply auto-submit** for consistent contractors

---

## Three Runtimes

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. React/TypeScript Frontend (Vite)                                 │
│     src/TimesheetSystem.tsx (~6500 lines, monolith)                  │
│     Hosted: Vercel → time.mysynergie.net                             │
├─────────────────────────────────────────────────────────────────────┤
│  2. Supabase Edge Functions (Deno)                                   │
│     supabase/functions/                                              │
│     Hosted: Supabase project mimlatvdwxqtgxrgcins                    │
├─────────────────────────────────────────────────────────────────────┤
│  3. Node.js Email Poller                                             │
│     scripts/poller/poller.js (~5000 lines)                           │
│     Hosted: GitHub Actions, triggered :28 past every hour            │
└─────────────────────────────────────────────────────────────────────┘
```

All three write to and read from the same **Supabase PostgreSQL** database.

### How They Interact

```
pg_cron job 7 (:28/hr)  → trigger-poller edge fn → GitHub workflow_dispatch
                        → poller.js runs
                            → IMAP fetch (timesheets@mysynergie.net, UNSEEN only)
                            → DMARC sweep (delete)
                            → parse XLSX/PDF/CSV/DOCX
                            → POST ingest-timesheet | ingest-invoice
                            → POST send-timesheet-report
                            → writes system_settings.poller_last_run heartbeat

pg_cron job (:00/hr)    → POST send-reminder → per-user time-window check
                                             → Brevo SMTP send

pg_cron job 8 (:47/hr)  → POST monitor-health → 5 Tier 1 SLO checks
                                             → alerts via helpdesk on breach

Frontend  ← Supabase Auth (sessionStorage — tab-isolated)
          ← Supabase Realtime subscription on timesheets table
          → REST via @supabase/supabase-js
          → edge fns: create-user, impersonate-user, ingest-invoice (accountant path)
          → GitHub Actions dispatch (mark-emails-unseen manual workflow)
```

---

## User Roles

### `timesheetuser` (Contractor)
- Submit weekly timesheets via portal drag-drop or manual entry
- View submission history and status
- **0-hour submission guard** (2026-08-11) — `window.confirm` warns before submitting a 0-hour week; explicit confirmation required
- Manage invoices (if `invoice_enabled = true`)
- Manage payment profiles (bank / company details, `payment_terms` NET15/30/45/60)
- Receive reminder emails (Friday 5pm friendly, then Mon–Fri 9am urgent)

### `manager`
- Approve or reject timesheets for direct reports (via portal, not email — see below)
- View team status
- **Note:** Contractors with no manager are auto-approved on submit
- The per-timesheet manager approval email flow (`email_approval_tokens`) exists in `send-reminder` code but is **unwired** — the DB table doesn't exist and the frontend never calls it. Approvals happen in the portal only.

### `accountant`
Multi-tab UI (grew substantially in July 2026):
- **Weekly tab** — grid view for a single week (Prev/Next nav). KPI row includes a Submission Channels card (Portal count, Email count, % split, progress bar). Grid is `md:grid-cols-4`.
- **Timesheet Only tab** — filterable list view with date range + quick selectors
- **Consolidated tab** — multi-week summary by contractor. Project filter pills, CSV export, Submission Channels KPI card as a 5th grid column when `sourceCounts` prop is passed. Sorted by location then name.
- **Invoices tab** — approve / reject / re-approve / edit-period / switch payment profiles. Convera matcher badges (5-level weak/strong). Filter pipeline: `prePayOnFiltered` → `preStatusFiltered` → `filtered`. Auto-defaults to latest month on load. Auto-YES anomaly detector runs post-parse.
- **Payments tab** — imports Convera transaction CSVs, runs 5-level matcher (beneficiary-ID first, IBAN fallback), lets accountant confirm auto-matches, exports QB Payments IIF, `matcher_ignore` fences for legacy Submitted→Approved→Paid rows.
- **Client Invoicing** — export contractor hours to client invoice CSV, import into printable modal (blue cells = hour overrides), print with modern accent-bar visual design + page-counter footer.

Also imports QuickBooks XLSX (Transaction Detail by Account) client-side via SheetJS for legacy reconciliation.

### `vendormanager`
- Scoped to their vendor's contractors — timesheets, invoices, dashboards.

### `admin`
- User CRUD via `create-user` edge fn (public signup disabled; new fields include `payment_terms` + `location_type` + `invoice_enabled` default false)
- Project management
- Manual reminder trigger
- Import Log view (every email produces a log entry — no silent drops as of 2026-08-11)
- Impersonation via one-time magic link (target user only; admin session unaffected)

---

## Full Data Flow

### Contractor Submits via Portal
1. Contractor logs in → enters hours per day for a Mon–Sun week
2. `week_start` is always the **Monday** date (`YYYY-MM-DD`)
3. **0-hour guard:** if total = 0, `window.confirm` blocks unless explicit "yes I mean it"
4. Locked days check: any day in `timesheets.locked_days[]` (from a paid invoice period) is rejected
5. No manager → auto-approved (`approved_by: 'self-submit'`); manager assigned → `status: 'pending'`
6. Realtime subscription (`supabase.channel('timesheets-realtime')`) updates accountant/manager views live

### Contractor Submits via Email
1. Contractor emails `timesheets@mysynergie.net`, or internal staff forwards it
2. Poller runs :28 past each hour, IMAP fetch marks emails SEEN authoritatively
3. **DMARC sweep** first (`ab73c0d`, 2026-07-12) — deletes DMARC reports regardless of `\Seen` flag
4. **7-day age gate** on UNSEEN search (`d9bc308`) — filters phantom re-fetches
5. Resolve actual contractor:
   - Direct: `fromEmail`
   - Internal forwarder (accounting@, lpinto@, contracts@, contracts@cheetah-it.com, helpdesk@): body-parsed forwarded-from email
   - Intuit/QuickBooks notification: attachment filename → `find_profile_by_first_name` RPC
   - Croatian sequential invoice numbers (`6-1-1` etc.) — treated as real, not errors
   - NET SCALE = Ivica Zlatar (special sender mapping)
6. `isKnownContractor` allowlist (Layer 1). 14-day grace window for inactive contractors (`bf18e91`).
7. Parse XLSX (via SheetJS) or PDF (regex first, then Claude vision fallback with model routing based on `profiles.invoice_template`)
8. POST to `ingest-timesheet` (or `ingest-invoice` if classified as invoice)
9. Edge fn applies correction rules, upserts, writes to `email_import_log`
10. End-of-run: heartbeat + summary email + `send-timesheet-report` triggered

### Every Email Gets Logged (2026-08-11)
Three prior silent-drop paths now produce distinct log entries via `logOnly:true`:
- `unknown_pdf_type` — PDF classifier couldn't tell invoice vs timesheet
- `xlsx_parse_failed` — XLSX threw / returned no timesheets
- `parser_no_extract` — Claude vision called but returned no usable data

Plus `unsupported_file_type` (attachment ext not xlsx/pdf/docx) and `auto_yes_zero_blocked` (sanity gate refusal). Full status vocabulary in [edge-functions.md](edge-functions.md#email_import_logparse_status-vocabulary).

### Zero-Hour Submission Accept + Confirm Loop (2026-08-11)
When Claude vision returns all-zero hours WITH a valid week and contractor name (LOA/PTO/sick pattern), the poller trusts it. Edge fn splits into:
- `success_zero_hours` (direct) — Brevo confirmation email sent to contractor: *"we got 0 hours, reply with correction if wrong"*. `verified_zero_hours=false`.
- `success_zero_hours_forwarded` (internal forwarder) — auto-sets `verified_zero_hours=true`, no email (accountant already validated).

### Contractor Replies YES to Reminder
1. Friday reminder contains "Reply YES" option with week date in subject
2. Contractor replies affirmatively
3. Poller: no attachment + subject `Re:` + week parseable → `classifyReply()`
4. **Deterministic regex** (`BARE_YES_RE`) — no LLM. Reply-header strip + `>`-line strip + signature cut + length gate + whitelist match. See [ai-agent.md](ai-agent.md) for full detail on why the LLM was replaced.
5. YES → `fetchLastApprovedEntries` (service key required — RLS blocks anon) → `setReplyPendingFlag` → `autoSubmitFromReply` (POST with `messageId='reply-yes-{uuid}'`)
6. Non-YES (`OTHER`) → forward to helpdesk. No `MODIFY` branch.

### Reminder Cycle
1. pg_cron fires top of hour
2. `send-reminder`:
   - Acquires invocation lock (atomic INSERT on `system_settings`) — prevents pg_net flush duplicates
   - **INVOCATION_EMAIL_CAP = 150** (bumped from 80 on 2026-08-11)
   - Per-user loop: Friday 5pm local = friendly; weekday 9am/11am local = urgent
   - At hour 9–10: defers if poller age > 45 min; hour 11 fires unconditionally (safety net)
   - Per-user atomic daily claim (INSERT on `system_settings`) prevents double-sends
   - `reply_yes_pending_{userId}` 72h suppressor for post-YES contractors

### Invoice Flow (End-to-End)
1. Contractor → accounting@ → validated → forwarded to `timesheets@mysynergie.net` (forwarder gate)
2. Poller classifies as invoice (no timesheet attachment detected, PDF classified as invoice/both, or DOCX)
3. `extractInvoice()` — profile-based routing via `profiles.invoice_template`:
   - `regex` → skip Claude
   - `claude_vision` → skip regex
   - `null` / `claude_full` → try Groq mid-tier, fall through to Claude
4. **Anomaly detector** (2026-08-06, deployed) — deterministic post-parse rulebook catches Juran/Zlatar/Nikolina originals class. Flags with all candidates on disagreement rather than auto-picking ([[feedback_flag_on_disagreement]]).
5. **Bimosoft UK ALT guardrail** — all Bimosoft invoices must link to UK ALT profile; overrides matcher, redirects instead of skipping ([[project_bimosoft_uk_alt]]).
6. POST to `ingest-invoice` with `forwardedBy` set; anomaly-flagged invoices land as `flagged` for accountant review
7. Timesheet locking: on approve, computes `locked_days[]` from invoice period + writes to timesheets

### Payment Flow (Convera)
1. Accountant exports Convera Batch CSV from Payments tab (grouped by beneficiary; country from IBAN; CRLF endings; short-name suggestion for auto-link next import)
2. Wire transfer executed externally
3. Convera transaction CSV imported back → matcher runs (5-level beneficiary-ID first, IBAN fallback, weak badge for level ≥ 3, ±14/+7 date window on weak matches)
4. Accountant confirms auto-matches → invoice status transitions to `paid` with `paid_date`
5. QB Payment IIF export per batch (CHECK not BILLPMT, DOCNUM = wire confirmation to survive 11-char IIF limit)

### SLO Alerting (`monitor-health`, pg_cron job 8)
Every :47/hr. 5 Tier 1 SLOs:
- `poller_heartbeat` (2 consecutive breaches required, per `e1e4854`)
- `zero_hour_timesheet` (auto-YES zeros without `verified_zero_hours=true`) — silenced since 2026-07-06 per [[project_zero_hour_visibility_gap]]
- Plus 3 others; verified via `?dry_run=true`
- On breach: helpdesk email; state tracked in `system_alerts_state`

---

## Key Architectural Decisions and WHY

### pg_cron for reminders + poller trigger
GitHub Actions scheduled cron was lagging 3–28h on this low-activity repo. pg_cron fires immediately. The `trigger-poller` pattern (pg_cron → edge fn → workflow_dispatch) gives true hourly execution without re-architecting the poller.

### No auto-creation of users from email
Two-layer: (1) poller's `isKnownContractor` allowlist RPC; (2) `ingest-timesheet` returns `unknown_contractor` if email not in `profiles`. Public signups disabled 2026-05-22 via Management API.

### sessionStorage for auth (not localStorage)
Tab isolation. Opening admin + impersonating a contractor in two tabs keeps them independent.

### Week keys are always Monday dates
`week_start` = Monday `YYYY-MM-DD`. Display = "W/E Sunday" (`Monday + 6 days`). Variable named `sun`, not `fri`. Always use `parseLocalDate()` for date arithmetic, never `new Date(dateString)`.

### `source='direct'` vs `source='imported'`
Portal = `direct`; email = `imported`. Correction rules:
- `direct` + no forwarder + same hours → `duplicate`
- `direct` + no forwarder + different hours → `correction_pending` (contractor can't reduce own hours without review)
- `direct` + `forwardedBy` set → replace outright, auto-approve (accountant is authoritative, can reduce)
- `imported` exists → `mergeEntries()` max per day (handles month-end splits)
- No existing → create `approved`, `source='imported'`

### Forwarder-only gate for invoices
Direct contractor invoice submissions rejected with `direct_invoice_not_accepted`. Accounting validates before DB. Preserves the human checkpoint.

### `matcher_ignore` fences (2026-07)
`invoices.matcher_ignore` + `convera_transactions.matcher_ignore` fence pre-Submitted→Approved→Paid legacy from the matcher. Cutoffs: 2026-04-28 invoices / 2026-06-20 transactions. Rows stay visible everywhere except the matcher.

### `verified_zero_hours` columns on timesheets
Added to distinguish "contractor legitimately submitted 0 hours (LOA/PTO/sick)" from "parser artifact". `monitor-health` SLO watches for auto-YES message IDs paired with `verified_zero_hours=false`. Auto-set true when a zero-hour submission comes via internal forwarder.

### Timesheet locking
`locked_days timestamptz[]` on timesheets. Set on invoice approval. Hard-rejects re-submissions to accountant. **Silent bypass bug fixed 2026-07-08** (`2847e9a`) — column was `timestamptz[]` but compared to date strings; every lock had been theater since ship. Damir 552 only definitive victim.

### Client Invoicing MVP-A → MVP-B
MVP-A (2026-07-02) — CSV export + import round-trip. `hour_overrides` table exists in DB **but has no migration file** (GOTCHA). MVP-B (2026-07-14→21) — printable invoice modal, modern accent-bar visual redesign, print CSS isolation, page-counter footer.

---

## Codebase Layout

```
timesheet-app/
├── src/
│   ├── TimesheetSystem.tsx           # ~6500-line monolith
│   └── supabaseClient.ts             # sessionStorage-backed client
├── supabase/functions/
│   ├── ingest-timesheet/             # Main email → timesheet ingest
│   ├── ingest-invoice/               # Invoice ingest + anomaly detector
│   ├── send-reminder/                # Reminders, invites, (unwired) email approval
│   ├── send-timesheet-report/        # Accounting summary after each poller run
│   ├── send-project-consolidation/   # Client project consolidation (sort by location)
│   ├── create-user/                  # Admin-only user creation (payment_terms, location_type)
│   ├── impersonate-user/             # Admin-only magic link
│   ├── trigger-poller/               # pg_cron → GitHub workflow_dispatch bridge
│   ├── monitor-health/               # SLO checker (pg_cron job 8, :47/hr)
│   ├── parse-convera/                # Convera XLS/CSV parser (server-side)
│   ├── reconcile-invoices/           # Invoice ↔ Convera reconciliation
│   └── qb-web-connector/             # SOAP endpoint for QuickBooks Web Connector (in-flight)
├── scripts/poller/
│   └── poller.js                     # ~5000-line Node.js poller
├── scripts/one-off/                  # Ad-hoc scripts (gitignored except a few utils)
├── docs/
│   ├── system-overview.md            # This file
│   ├── database-schema.md
│   ├── edge-functions.md
│   ├── ai-agent.md                   # Deterministic YES pipeline + Groq's remaining roles
│   ├── invoice-pipeline.md
│   ├── poller-architecture.md
│   ├── changelog.md
│   └── open-questions.md
└── .github/workflows/
    ├── poll-timesheets.yml            # Poller (workflow_dispatch only — cron disabled)
    ├── mark-emails-unseen.yml         # Manual: reprocess emails
    ├── send-consolidation-report.yml  # Client consolidation cron
    ├── send-reminders.yml             # DISABLED — pg_cron owns this
    └── backup.yml                     # Daily pg_dump → 30-day GitHub Actions artifact
```

---

## Environment Variables Reference

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend `.env.local` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env.local` | Public anon key |
| `IMAP_PASS` | GitHub Actions secret | IONOS mailbox password |
| `IMAP_USER` / `IMAP_HOST` / `IMAP_PORT` | Supabase secret | IMAP connection (poller reads from env) |
| `INGEST_URL` | GitHub Actions secret | URL of `ingest-timesheet` edge fn |
| `INGEST_SECRET` | GitHub Actions + Supabase secret | Shared secret for edge fn auth |
| `BREVO_API_KEY` | GitHub Actions + Supabase secret | Brevo SMTP API |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions + auto Supabase | Service-role DB writes |
| `GROQ_API_KEY` | GitHub Actions secret | Groq (contractor resolver, week sanity, invoice vision) |
| `ANTHROPIC_API_KEY` | GitHub Actions secret | Claude vision (timesheet & invoice PDFs) |
| `GITHUB_PAT` | Supabase secret | Classic PAT for `trigger-poller` workflow_dispatch |
| `FROM_EMAIL` / `FROM_NAME` / `APP_URL` | Supabase secret | Brevo sender identity + portal URL |
| `SUPABASE_PAT` (`SB_ANALYTICS_PAT`) | Local scripts + Supabase | Personal access token for Management API |

---

## Key Conventions

- **Week keys:** Always Monday `YYYY-MM-DD`. Display as "W/E Sunday."
- **Date parsing:** Always `parseLocalDate()`. Never `new Date(dateString)` for date math.
- **DB column naming:** `snake_case` in Supabase; `camelCase` in TS interfaces. Mapped at fetch time.
- **Holiday data:** 2026 + 2027 for US, GB, CA, HR, RS, BA, SI, MK hardcoded in `TimesheetSystem.tsx`. Update annually.
- **Test accounts:** `isTestAccount(name)` checks for "hotmail", "yahoo", or "test" in name field. Applied in bulk ops, reports, reminders. See docs/open-questions.md #19 for the configurability question.
- **RLS:** Never use anon key for direct table reads/writes in the poller. Silent `[]` return. Use service key or SECURITY DEFINER RPCs ([[feedback_service_role_key]]).
- **Edge fn deploy:** `npx supabase functions deploy <name> --no-verify-jwt --project-ref mimlatvdwxqtgxrgcins`. Forgetting `--no-verify-jwt` requires a manual Dashboard fix.
- **git add:** Always explicit filenames. `git add -A` accidentally included secrets and PDFs on 2026-05-27 ([[feedback_git_add]]).
- **Hotfix branching:** While a long-running feature branch is idle, land hotfixes on their own branch off main, then rebase ([[feedback_hotfix_branching]]).
- **Create-vs-edit path split:** When adding a `profiles` field, update BOTH: frontend edit-path `updates{}`, frontend create-path fetch body, `create-user` edge fn destructure, edge fn INSERT ([[feedback_create_edit_path_split]]).
