# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `accountant` — consolidated view across all employees, invoice approvals, CSV export
- `vendormanager` — manage vendor contractor timesheets and invoices
- `admin` — user/project CRUD, reminder emails, import log

Authentication uses Supabase Auth. The client is initialized in `src/supabaseClient.ts` with `sessionStorage` (not `localStorage`) so sessions are tab-isolated.

### 2. Supabase Edge Functions — `supabase/functions/`

**`ingest-timesheet/index.ts`** (Deno) — Called by the email poller. Handles:
- Auth via `x-ingest-secret` header (JWT verification disabled)
- User find-or-create (auto-provisions accounts for new contractors)
- Timesheet upsert with correction rules: `source='direct'` records are never overwritten; `source='imported'` records get reset to pending
- Import deduplication via `email_import_log` table

**`send-reminder/index.ts`** (Deno) — Sends reminder emails via Brevo API. Handles timesheet reminders (Friday 5pm first, then daily Mon–Fri 9am), manager approval reminders, accountant invoice reminders, and welcome emails.

### 3. Email Poller — `scripts/poller/poller.js`
Node.js script that runs **hourly** via GitHub Actions (`cron: '30 * * * *'`). It:
- Connects to IMAP (`imap.ionos.com`) and fetches UNSEEN emails
- Parses XLSX and PDF timesheet attachments
- Resolves the actual contractor email from forwarded messages (handles internal forwarders)
- POSTs structured data to the `ingest-timesheet` edge function

### Supabase Tables
- `profiles` — user accounts (extends `auth.users`), includes `role`, `country`, `region`, `project_id`, `invoice_enabled`
- `timesheets` — weekly timesheets; `entries` is a JSON object of `{dateKey: {hours, isHoliday, ...}}`; `source` is `'direct'` or `'imported'`; `week_start` is always Monday (ISO `YYYY-MM-DD`)
- `invoices` — contractor invoices with `lines[]`, `payment_profile` snapshot, `attachment_path` (Supabase Storage bucket: `invoice-attachments`)
- `payment_profiles` — bank/company details attached to invoices
- `projects` — project codes and statuses
- `email_import_log` — audit log for every email the poller processes

### Realtime
The frontend subscribes to `timesheets` table changes via `supabase.channel('timesheets-realtime')` to keep the manager/accountant views live.

### GitHub Actions
- `.github/workflows/` contains the email poller workflow (runs `scripts/poller/poller.js`) and a daily `pg_dump` backup workflow.

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
