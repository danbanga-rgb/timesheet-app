# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session startup

At the start of every session, immediately schedule two recurring crons using CronCreate:

**1. Hourly memory save** (every session):
- **Schedule:** `13 * * * 1-5` (every hour, weekdays)
- **Prompt:** Review `git log --oneline -10`, compare against MEMORY.md, and save any non-obvious decisions or behavioral changes to the appropriate memory file. Update MEMORY.md index if new files added. Skip anything derivable from reading code or git history.

**2. Monthly invoice parser review** (durable: true — persists across sessions):
- First check `CronList` — if a job with a prompt containing "MONTHLY INVOICE PARSER REVIEW" already exists, skip creation.
- **Schedule:** `17 9 8 * *` (9:17am on the 8th of each month)
- **durable: true**
- **Prompt:** (full text below — copy exactly)

```
MONTHLY INVOICE PARSER REVIEW — automated session task. DO NOT edit parser.js or push anything until Dan approves.

1. Find SUPABASE_SERVICE_ROLE_KEY: check process.env, then read scripts/poller/.env if it exists, then read .env.local, then ask user.

2. Run: cd /Users/dbanga/timesheet-app && SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/monthly-invoice-analysis.js
   Read ALL stdout output carefully.

3. For every contractor listed under "claude_full" calls:
   a. Fetch their PDF: GET https://mimlatvdwxqtgxrgcins.supabase.co/storage/v1/object/invoice-attachments/{invoice_id}/original.pdf with Authorization: Bearer <key>
   b. Extract the PDF text (use pdf-parse if available in scripts/poller/node_modules, or read raw bytes and extract text spans)
   c. Identify the invoice layout: where is the period, hours, rate, total, payment block?
   d. Draft the regex patterns you WOULD write — but do not write them yet.

4. Present Dan with a complete review package:
   - Summary: total invoices, Claude/Groq/regex split, estimated $ cost
   - Per-contractor: what Claude extracted, what the PDF text looks like, the exact regex patterns you propose to add
   - Who still needs Claude (image PDFs, patterns too variable to regex)
   - Any anomalies in the invoice data worth flagging

5. STOP. Wait for Dan to review and approve each contractor's proposed patterns before touching parser.js.
   Only after explicit approval: edit scripts/invoice-parser/parser.js, test, commit, push.
```

## Memory save triggers — do not wait to be asked

Save memory proactively in all of these situations:
1. **Hourly cron fires** (above)
2. **User signs out / says they're done for the day**
3. **After any significant workstream completes** (new feature, bug fix, architectural decision) — save immediately, don't wait for the cron
4. **When the conversation is getting long** — long context is a proxy for nearing the daily usage limit; save before it cuts off and the session is lost

## Commands

```bash
# Frontend
npm run dev          # Vite dev server (hot reload)
npm run build        # tsc -b && vite build
npm run lint         # ESLint
npm run preview      # Preview production build

# Email poller (Node.js, runs in GitHub Actions)
cd scripts/poller && npm install && node poller.js

# Edge functions are deployed to Supabase; no local test runner is configured
```

## Architecture

This is a **Synergie timesheet management system** with three distinct runtimes:

### 1. Frontend — `src/`
A single-page React + TypeScript app (Vite). Virtually all UI logic lives in one large file: **`src/TimesheetSystem.tsx`** (~5200 lines). It contains:
- All TypeScript interfaces at the top
- One monolithic `TimesheetSystem` component with all state and handlers
- A `ConsolidatedTable` component extracted above the main component
- Role-based rendering: the JSX returns entirely different UIs depending on `currentUser.role`

**User roles and their views:**
- `timesheetuser` — submit weekly timesheets, manage invoices, payment profiles
- `manager` — approve/reject timesheets for their direct reports
- `accountant` — consolidated view across all employees, invoice approvals, CSV export, QuickBooks XLSX import (client-side SheetJS parsing of Transaction Detail by Account exports)
- `vendormanager` — manage vendor contractor timesheets and invoices
- `admin` — user/project CRUD, reminder emails, import log

Authentication uses Supabase Auth. The client is initialized in `src/supabaseClient.ts` with `sessionStorage` (not `localStorage`) so sessions are tab-isolated.

### 2. Supabase Edge Functions — `supabase/functions/`

**`ingest-timesheet/index.ts`** (Deno) — Called by the email poller. Handles:
- Auth via `x-ingest-secret` header (JWT verification disabled)
- User lookup only — **no auto-creation**. Unknown emails return `{ ok: false, error: 'unknown_contractor' }` and are logged to `email_import_log`. Users must be created by admin first.
- Timesheet upsert with correction rules:
  - `source='direct'` + `forwardedBy=null` (contractor self-correction) → `correction_pending`, never auto-applied
  - `source='direct'` + `forwardedBy` set (internal forwarder) → entries replaced outright and auto-approved (accountant is authoritative; can reduce hours)
  - `source='imported'` → merge with `max` per day (`mergeEntries()`), kept `approved` — handles month-end partial-week splits
  - No existing record → create as `approved`, `source='imported'`
- Import deduplication via `email_import_log` table

**`create-user/index.ts`** (Deno) — Admin-only. Creates a new `auth.users` record + `profiles` row using the service role key. Required because public signups are disabled — the frontend's admin form calls this instead of `supabase.auth.signUp()`. Verifies caller is admin via JWT.

**`send-reminder/index.ts`** (Deno) — Sends reminder emails via Brevo API. Triggered by pg_cron (not GitHub Actions — that workflow is disabled). Handles:
- Timesheet reminders: Friday 5pm local first (friendly tone), then Mon–Fri 9am daily (urgent tone) while still missing
- Manager approval reminders. **Accountant section is currently disabled** (skipped with `action: 'skipped (disabled)'`) — covered by `send-timesheet-report` instead.
- Skips users where `profiles.reminders_enabled = false`
- `REMINDER_CUTOFF = '2026-04-27'` — weeks before this date are never included in reminders
- Reminder email body offers three submission options: app login, reply-to-email with attachment, direct email to `timesheets@mysynergie.net`. First-login note directs to `helpdesk@synergietechsolutions.com`.
- `action: 'invite'` — generates a server-side magic link (auth.admin.generateLink) and sends a styled invite email; no raw password ever sent
- `?force=true` query param bypasses time window checks and fires immediately for all missing users
- Week ending date is always **Monday + 6 days = Sunday**. Variable named `sun`, not `fri`.
- Time windows use `hour >= 9 && hour <= 10` (not exact hour) to tolerate cron delays

**`impersonate-user/index.ts`** (Deno) — Admin-only. Verifies caller is admin via JWT, generates a one-time magic link for the target user, returns the URL. Frontend opens it in a new tab; admin session is unaffected.

**`send-timesheet-report/index.ts`** (Deno) — Called by the poller after each run. Emails a per-week missing-timesheet CSV report to accounting. Returns `{ submitted, total, missing }`.

### 3. Email Poller — `scripts/poller/poller.js`
Node.js script that runs **hourly** via GitHub Actions (`cron: '30 * * * *'`). It:
- Connects to IMAP (`imap.ionos.com`) and fetches UNSEEN emails
- Parses XLSX and PDF timesheet attachments
- Resolves the actual contractor email from forwarded messages. **Internal forwarders** are listed in the `INTERNAL_FORWARDERS` env var in `poll-timesheets.yml` (not a secret — hardcoded in the workflow file). Current list: `contracts@synergietechsolutions.com`, `accounting@synergietechsolutions.com`, `lpinto@synergietechsolutions.com`, `helpdesk@synergietechsolutions.com`, `contracts@cheetah-it.com` (Cheetah IT — forwards contractor timesheets to the system inbox).
- POSTs structured data to the `ingest-timesheet` edge function
- Security guardrails: sender allowlist via `profile_email_exists` RPC (fail-open on errors), volume cap of 20 emails/run, 10MB attachment size limit
- `mark-emails-unseen.yml` GitHub Actions workflow can reprocess emails by marking them unseen via IMAP

### Supabase Tables
- `profiles` — user accounts (extends `auth.users`), includes `role`, `country`, `region`, `project_id`, `invoice_enabled`, `reminders_enabled` (bool, default true — admin can toggle per user)
- `timesheets` — weekly timesheets; `entries` is a JSON object of `{dateKey: {hours, isHoliday, ...}}`; `source` is `'direct'` or `'imported'`; `week_start` is always Monday (ISO `YYYY-MM-DD`)
- `invoices` — contractor invoices with `lines[]`, `payment_profile` snapshot, `attachment_path` (Supabase Storage bucket: `invoice-attachments`)
- `payment_profiles` — bank/company details attached to invoices
- `projects` — project codes and statuses
- `email_import_log` — audit log for every email the poller processes

### Realtime
The frontend subscribes to `timesheets` table changes via `supabase.channel('timesheets-realtime')` to keep the manager/accountant views live.

### Reminder Scheduling — pg_cron
Reminders are fired by a **Supabase pg_cron job** (not GitHub Actions). The `send-reminders.yml` workflow is disabled.
- Schedule: `0 * * * *` (top of every hour)
- To pause: `SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'send-reminders'`
- To resume: `SELECT cron.schedule('send-reminders', '0 * * * *', $$SELECT net.http_post(...)$$)`
- Use the Supabase Management API with PAT to run these queries: `POST /v1/projects/{ref}/database/query`
- Edge function logs are queryable via `GET /v1/projects/{ref}/analytics/endpoints/logs.all` with PAT

### GitHub Actions
- `poll-timesheets.yml` — runs the email poller hourly (`cron: '30 * * * *'`)
- `mark-emails-unseen.yml` — manual workflow to reprocess emails (marks them unseen via IMAP so the poller picks them up again)
- `send-reminders.yml` — **disabled** (replaced by pg_cron)
- `pg-dump-backup.yml` — daily database backup

## Environment Variables

**Frontend (`.env.local`):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Poller (GitHub Actions secrets):**
- `IMAP_PASS`, `INGEST_URL`, `INGEST_SECRET`, `BREVO_API_KEY`

**Edge functions (Supabase secrets):**
- `INGEST_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (auto-provided by Supabase), `BREVO_API_KEY`

## Key Conventions

- **Week keys** are always Monday dates (`YYYY-MM-DD`). `getWeekDates()` returns Mon–Sun; display labels show "W/E" Sunday.
- **Timezone handling**: `tzMap` in both `TimesheetSystem.tsx` and `send-reminder` maps `country-region` to IANA timezone strings. Always use `parseLocalDate()` (splits on `-`, avoids UTC offset issues) instead of `new Date(dateString)` for date arithmetic.
- **Timesheet entries**: stored as `Record<string, TimeEntry>` where keys are `YYYY-MM-DD` date strings. Each entry has `hours` (string), optional `isHoliday`, `holidayName`, `isWeekend`.
- **Holiday data** for 2026 (US, GB, CA, HR, RS, BA, SI, MK) is hardcoded in `TimesheetSystem.tsx`.
- **Invoice payment method** defaults to Intuit for US, Convera for all other countries; accountants can override per invoice.
- Supabase DB column names are `snake_case`; frontend interface fields are `camelCase`. Profile loading normalises the mapping at fetch time.
