# System Overview — Synergie Timesheet Management System

> Generated 2026-06-12. May need review as the system evolves.

---

## What This Product Does

Synergie is a staffing/contracting company. This system manages:

1. **Timesheet collection** from ~65 contractors across the US, UK, Canada, and Eastern Europe — via a web portal or email attachment
2. **Invoice ingestion** — accounting forwards contractor invoices into the system
3. **Manager approval workflow** — contractors submit, managers approve, accountants see consolidated views
4. **Payment reconciliation** — invoices matched against Convera payment transactions
5. **Reminders and AI auto-submission** — automated reminder emails, with optional YES-reply auto-submit for consistent contractors

---

## Three Runtimes

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. React/TypeScript Frontend (Vite)                                 │
│     src/TimesheetSystem.tsx                                          │
│     Hosted: Netlify / static hosting → time.mysynergie.net          │
├─────────────────────────────────────────────────────────────────────┤
│  2. Supabase Edge Functions (Deno)                                   │
│     supabase/functions/                                              │
│     Hosted: Supabase project mimlatvdwxqtgxrgcins                   │
├─────────────────────────────────────────────────────────────────────┤
│  3. Node.js Email Poller                                             │
│     scripts/poller/poller.js                                         │
│     Hosted: GitHub Actions, triggered :28 past every hour           │
└─────────────────────────────────────────────────────────────────────┘
```

All three write to and read from the same **Supabase PostgreSQL** database.

### How They Interact

```
pg_cron (:28/hr) → trigger-poller edge fn → GitHub workflow_dispatch
                → poller.js runs
                    → reads IMAP inbox (timesheets@mysynergie.net)
                    → parses XLSX/PDF/CSV/DOCX/EML attachments
                    → POST /functions/v1/ingest-timesheet (Edge fn)
                    → POST /functions/v1/ingest-invoice (Edge fn)
                    → POST /functions/v1/send-timesheet-report (Edge fn)
                    → writes heartbeat to system_settings.poller_last_run

pg_cron (:00/hr) → POST /functions/v1/send-reminder (Edge fn)
                    → per-user time-window check
                    → send via Brevo SMTP API

Frontend ← Supabase Auth (sessionStorage, tab-isolated)
         ← Supabase Realtime subscription (timesheets table)
         → REST API via @supabase/supabase-js
         → edge functions (create-user, impersonate-user)
```

---

## User Roles

### `timesheetuser` (Contractor)
- Submit weekly timesheets via portal drag-drop or enter hours per day
- View their own submission history and status
- Manage invoices (if `invoice_enabled = true`)
- Manage payment profiles (bank / company details)
- Receive reminder emails (Friday 5pm friendly, then Mon–Fri 9am urgent)

### `manager`
- Approve or reject timesheets for direct reports
- Receive email approval requests (single-use tokenised links, 7-day TTL)
- View team timesheet status
- **Note:** Contractors with no manager assigned are auto-approved on submit

### `accountant`
Four-tab UI:
- **Weekly tab** — grid view of all contractors for a single week (Prev/Next nav only). KPI row includes a **Submission Channels card** (Portal count, Email count, % split, progress bar — derived from `reportData`, no extra fetch). Grid is `md:grid-cols-4`.
- **Timesheet Only tab** — filterable list view with date range + quick selectors
- **Consolidated tab** — multi-week summary by contractor; project filter pills; CSV export. Includes a **Submission Channels KPI card** (5th card, `md:grid-cols-5`) derived from in-range timesheets (test accounts excluded). Passed to `ConsolidatedTable` via optional `sourceCounts` prop — manager view omits this prop and is unaffected.
- **Invoices tab** — all contractor invoices; approve, reject, switch payment profiles; Convera matching. Filter pipeline: `prePayOnFiltered` (all filters except pay-on date) → `preStatusFiltered` (adds pay-on, no status) → `filtered` (adds status). This order keeps status pill counts meaningful when switching tabs and keeps Pay On pills reactive to other filters. KPI cards derive from the filtered set. Auto-defaults to the latest invoice month on first load (`useEffect` on `invoices.length`). Pay On Date quick-select pills are dynamically built from distinct `payOnDate` values in DB, including a "Not assigned" pill for invoices with no pay date.

Accountant can also import QuickBooks XLSX (Transaction Detail by Account export, client-side SheetJS parsing) for payment reconciliation.

### `vendormanager`
- Manage vendor contractor timesheets and invoices
- Scoped view — does not see all contractors

### `admin`
- Full user CRUD (creates accounts via `create-user` edge function — public signup is disabled)
- Project management
- Trigger reminder emails manually
- Import log view
- Impersonate any user (generates a one-time magic link for the target user)

---

## Full Data Flow

### Contractor Submits via Portal
1. Contractor logs in → submits timesheet hours for a Mon–Sun week
2. `week_start` is always the **Monday** date (`YYYY-MM-DD`)
3. If contractor has no manager → auto-approved (`approved_by: 'self-submit'`)
4. If contractor has a manager → `status: 'pending'`; manager notified via Brevo email with approve/reject links (7-day, single-use tokens)
5. Manager clicks link → `send-reminder` edge function's `process_approval` handler validates token → updates `timesheets.status`
6. Frontend subscribes to Realtime changes on the `timesheets` table — accountant and manager views update live

### Contractor Submits via Email
1. Contractor emails `timesheets@mysynergie.net` (or internal staff forwards it there)
2. Poller picks up UNSEEN emails at :28 past each hour
3. IMAP fetch marks emails as SEEN (authoritative — no re-open-and-mark-unseen step needed)
4. Poller resolves actual contractor email:
   - Direct email: `fromEmail` is the contractor
   - Internal forwarder (lpinto@, accounting@, contracts@, etc.): body text parsed for forwarded-from email
   - Intuit/QuickBooks notification: contractor name extracted from attachment filename, matched via `find_profile_by_first_name` RPC
   - Subject-name fallback: capitalised tokens from subject matched via `find_profiles_by_name_words` RPC
5. Poller calls `isKnownContractor` allowlist check (Layer 1 security)
6. Attachment parsed by `parseXlsx` or `parsePdf` depending on type
7. POST to `ingest-timesheet` edge function with structured data
8. Edge function applies correction rules (see database-schema.md for detail)
9. Email import logged to `email_import_log`
10. At end of run: heartbeat written, summary email sent to helpdesk, `send-timesheet-report` triggered

### Contractor Replies YES to Reminder (AI Agent — Phase A)
1. Friday reminder email contains "Reply YES" option with the week date in the subject
2. Contractor replies with YES / affirmative text
3. Poller detects: no attachment + subject starts "Re:" + week parseable from subject
4. Groq classifier (`llama-3.3-70b-versatile`) classifies intent: YES / MODIFY / NO
5. YES: `fetchLastApprovedEntries` (service role key required — RLS blocks anon key) → copies last week's entries → `setReplyPendingFlag` (72h suppressor in system_settings) → `autoSubmitFromReply` → POST to `ingest-timesheet` with `message_id='reply-yes-{uuid}'`
6. MODIFY: pushed to `timesheetReports` as `reply_modify_pending` — no auto-submit yet
7. NO: pushed as `reply_no`, dropped

### Reminder Cycle
1. pg_cron fires at top of every hour
2. `send-reminder` edge function:
   - Acquires invocation lock (atomic INSERT on `system_settings`) — prevents duplicate runs if pg_net worker flushes a backlog
   - For each `timesheetuser` with `reminders_enabled = true` and a `start_date`:
     - Checks local time in their timezone (via `tzMap`)
     - Friday 5pm local: sends personalised "friendly" reminder; if contractor has consistent 3+ weeks history and is not portal-only, adds "Reply YES" option
     - Mon–Fri 9am local: sends "urgent" reminder for each overdue week
     - At 9am, defers if poller ran more than 45 minutes ago (to avoid reminding contractors who just submitted by email); fires unconditionally at 11am
   - Per-user atomic daily claim (INSERT on `system_settings`) prevents double-sends
   - Checks `reply_yes_pending_{userId}` flag — suppresses Monday reminders for 72h after a YES reply

### Invoice Flow
1. Contractor sends invoice to accounting@; accountant (lpinto) validates and forwards to `timesheets@mysynergie.net`
2. Poller classifies email as invoice (no timesheet attachment detected)
3. `extractInvoice()` parses: regex-first (free), Claude fallback (paid)
4. POST to `ingest-invoice` edge function with `forwardedBy` set
5. Edge function: forwarder gate (direct submissions rejected), user lookup, field validation, reconcile against approved timesheets, insert invoice
6. Accounting email sent after run

---

## Key Architectural Decisions and WHY

### pg_cron for reminders, not GitHub Actions
GitHub Actions scheduled cron was lagging 3–28 hours on this low-activity repo (shared runner queue deprioritises infrequent repos). pg_cron fires immediately at the exact scheduled second. The `trigger-poller` pattern (pg_cron → edge fn → workflow_dispatch) gives true hourly execution without re-architecting the poller.

### No auto-creation of users from email
Originally `ingest-timesheet` would auto-create a profile for any new email address. Disabled 2026-05-22 after a flooding incident. Defense is two-layer: (1) poller's `isKnownContractor` allowlist check; (2) `ingest-timesheet` returns `unknown_contractor` if email not found in `profiles`. Admin must create users first via the `create-user` edge function. This prevents phantom accounts and eliminates a spam vector.

### sessionStorage for auth (not localStorage)
Sessions are tab-isolated. Opening the app in two tabs (e.g. one as admin, one impersonating a contractor) keeps them independent. localStorage would share the session across tabs, making impersonation impossible without logging out.

### Public signups disabled
`disable_signup: true` set via Supabase Management API 2026-05-22. Contractors access the portal via magic links sent by admin (invite flow in `send-reminder`). The `create-user` edge function creates both `auth.users` and `profiles` rows using the service role key. This was a security hardening measure.

### Week keys are always Monday dates
All timesheet `week_start` values are Monday `YYYY-MM-DD`. Display shows "W/E Sunday" (Monday + 6 days). The variable for the week ending date is named `sun` throughout the codebase — not `fri`. Always use `parseLocalDate()` (splits on `-`, avoids UTC offset issues) instead of `new Date(dateString)` for date arithmetic.

### source='direct' vs source='imported'
Portal submissions are `source='direct'`. Email ingestion is `source='imported'`. This drives correction rules: direct submissions with an emailed correction get flagged `correction_pending` (contractor can't reduce their own hours without admin review); imported corrections max-merge per day (handles month-end partial-week splits). An internal forwarder override replaces entries outright because accountants may need to reduce hours.

### Forwarder-only gate for invoices
Invoices are only accepted when forwarded by an internal accountant (`forwardedBy` required). Direct contractor invoice submissions are rejected with `direct_invoice_not_accepted`. This preserves a human checkpoint — accounting validates the invoice before it enters the DB. Can be relaxed once the pipeline is proven.

### Magic link expiry: 24 hours
Default Supabase magic link TTL is 1 hour — too short for the invite chain: contractor → lpinto → Dan → portal invite. Updated to 24 hours via Management API. No code change required. A second invite to an already-active user is harmless (it just issues a new login link; account and data untouched).

---

## Codebase Layout

```
timesheet-app/
├── src/
│   ├── TimesheetSystem.tsx     # ~5200-line monolith: all UI, all state, all handlers
│   └── supabaseClient.ts       # Supabase client initialised with sessionStorage
├── supabase/
│   └── functions/
│       ├── ingest-timesheet/   # Main email ingestion
│       ├── ingest-invoice/     # Invoice ingestion
│       ├── send-reminder/      # Reminder emails + invite + email approval
│       ├── send-timesheet-report/  # Accounting summary email after each poller run
│       ├── create-user/        # Admin-only user creation
│       ├── impersonate-user/   # Admin-only magic link for target user
│       └── trigger-poller/     # pg_cron → GitHub workflow_dispatch bridge
├── scripts/poller/
│   └── poller.js               # ~3300-line Node.js email poller
├── docs/
│   ├── poller-architecture.md  # Deep-dive on poller internals — read before changing poller
│   ├── system-overview.md      # This file
│   ├── database-schema.md
│   ├── edge-functions.md
│   ├── ai-agent.md
│   ├── invoice-pipeline.md
│   └── changelog.md
└── .github/workflows/
    ├── poll-timesheets.yml      # Poller (workflow_dispatch only — cron disabled)
    ├── mark-emails-unseen.yml   # Manual: reprocess emails by marking them unseen
    ├── send-reminders.yml       # DISABLED — replaced by pg_cron
    └── pg-dump-backup.yml       # Daily database backup
```

---

## Environment Variables Reference

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | Frontend `.env.local` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env.local` | Supabase public anon key |
| `IMAP_PASS` | GitHub Actions secret | IONOS mailbox password |
| `INGEST_URL` | GitHub Actions secret | URL of `ingest-timesheet` edge fn |
| `INGEST_SECRET` | GitHub Actions secret + Supabase secret | Shared secret for edge fn auth |
| `BREVO_API_KEY` | GitHub Actions secret + Supabase secret | Brevo SMTP API key |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions secret + auto Supabase | Service role key for direct DB writes |
| `GROQ_API_KEY` | GitHub Actions secret | Groq API key for reply classifier |
| `GITHUB_PAT` | Supabase secret | Classic PAT for trigger-poller workflow_dispatch |
| `TIMESHEET_REPORT_URL` | Poller (hardcoded default) | URL of `send-timesheet-report` edge fn |

---

## Key Conventions

- **Week keys:** Always Monday `YYYY-MM-DD`. Display as "W/E Sunday."
- **Date parsing:** Always use `parseLocalDate()` (splits on `-`). Never `new Date(dateString)` for date arithmetic — this has caused UTC offset bugs.
- **DB column naming:** `snake_case` in Supabase; `camelCase` in TypeScript interfaces. `normaliseTimesheet()` and similar functions map at fetch time.
- **Holiday data:** 2026 holidays for US, GB, CA, HR, RS, BA, SI, MK are hardcoded in `TimesheetSystem.tsx`. Update annually.
- **Test accounts:** Filtered in all bulk operations, reports, and reminders by `isTestAccount(name)` which checks for "hotmail", "yahoo", or "test" in the name field.
- **RLS rule:** Never use the anon key for direct table reads/writes in the poller. RLS silently returns `[]` rather than an error. Use the service role key or SECURITY DEFINER RPCs.
- **Edge function deployment:** Always use `--no-verify-jwt` flag when deploying any Supabase edge function. Forgetting this requires a manual Dashboard fix (`JWT verification → disabled`).
- **git add:** Always stage files explicitly by name. `git add -A` accidentally included secrets and contractor PDFs on 2026-05-27.
