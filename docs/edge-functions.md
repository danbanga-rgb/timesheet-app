# Edge Functions Reference

> Generated 2026-06-12. May need review as the system evolves.

All functions are deployed to Supabase project `mimlatvdwxqtgxrgcins`.

**Deployment rule:** Always use `--no-verify-jwt` when deploying any edge function:
```
npx supabase functions deploy <name> --no-verify-jwt --project-ref mimlatvdwxqtgxrgcins
```
Forgetting this flag makes functions boot (visible in logs) but return `{"error":"Unauthorized"}` before the body runs. Fix via Dashboard: Function Settings → JWT verification → disabled.

---

## `ingest-timesheet`

**Purpose:** Receives parsed timesheet data from the Node.js poller and upserts into the database.

**Method:** POST

**Auth:** `x-ingest-secret` header (shared secret, not a JWT). JWT verification is disabled on this function.

**Request body:**
```json
{
  "messageId": "string (required)",
  "contractorEmail": "string (required)",
  "contractorName": "string | null",
  "subject": "string",
  "weekStart": "YYYY-MM-DD (required)",
  "weekCandidates": ["YYYY-MM-DD", ...],
  "correctionHint": "bool",
  "entries": "{ YYYY-MM-DD: { hours, isHoliday?, ... } } or { YYYY-MM-DD: number }",
  "total": "number",
  "attachmentName": "string",
  "attachmentType": "string",
  "parseNotes": "string",
  "run_id": "string (UUID)",
  "forwardedBy": "string | null"
}
```

**Special mode — `logOnly: true`:** Used by the poller to log unsupported file types (e.g. `.txt`) without ingesting. Creates a `parse_status='failed'` log entry only.

**Response:**
```json
{
  "ok": true,
  "action": "created | updated | correction_imported | correction_pending | duplicate",
  "parseStatus": "success | correction | correction_pending | duplicate | failed | partial",
  "userId": "uuid",
  "userName": "string",
  "wasCreated": false,
  "nameUpdated": "bool",
  "timesheetId": "number | null",
  "weekStart": "YYYY-MM-DD",
  "notes": "string",
  "attemptCount": "number"
}
```

Error response: `{ "ok": false, "error": "unknown_contractor" }` when email not in profiles.

### Key logic

**Deduplication:** Checks `email_import_log` for `message_id`. Statuses `success`, `duplicate`, `correction`, `correction_pending` block reprocessing. `failed` and `partial` delete the old log entry and allow retry (attempt_count incremented).

**User lookup:** `findUser()` — lookup by email in `profiles`. No auto-creation. If not found, logs `unknown_contractor` and returns 200 with `ok: false`. Two-layer defence: poller's `isKnownContractor` is Layer 1; this is the hard backstop.

**Name improvement:** If the contractor's profile name looks auto-generated (all lowercase, no space, matches email prefix) and the incoming name looks real (has space, 3–60 chars, doesn't start with digit), the profile name is updated.

**Week resolution:** `resolveWeek()` picks the best week from `weekCandidates[0]` (content-derived) and `weekCandidates[1]` (subject-derived):
1. Discard candidates more than 7 days in the future
2. Single valid candidate → use it
3. `correctionHint=true` → content week wins
4. One week empty, other occupied → prefer the empty one (new submission beats stale)
5. Both occupied → content week; both empty → content week

If all candidates are future-dated, clamps to current week Monday.

**Correction rules:** See database-schema.md for the full table. Short version:
- `source='direct'` + no forwarder + identical hours → `duplicate`
- `source='direct'` + no forwarder + different hours → `correction_pending`
- `source='direct'` + `forwardedBy` set → replace entries outright, auto-approve
- `source='imported'` exists → `mergeEntries()` max per day, keep `approved`
- No existing → create `approved`, `source='imported'`

**Logging:** Always writes to `email_import_log` with `from_email = forwardedBy || contractorEmail` and `resolved_email = contractorEmail`. This distinction enables channel classification in `send-timesheet-report`.

### Gotchas

- The function uses `SUPABASE_SERVICE_ROLE_KEY` for all DB operations (auto-injected by Supabase, plus added explicitly to the client constructor). Never relies on the JWT from the request.
- `wasCreated` is always `false` — auto-creation is disabled. The field exists for historical compatibility.
- `correctionHint` is a signal from the poller (detected `correction|corrected|revised|fixed` keywords in email subject/body) that helps week resolution prefer the content week.

---

## `send-reminder`

**Purpose:** Sends reminder emails to contractors and managers. Also handles invite emails and email-based manager approvals.

**Method:** POST (or GET for cron trigger)

**Auth:** None for cron trigger path; JWT verification can be enabled for human-triggered calls (but typically deployed with `--no-verify-jwt` to match the pg_cron call pattern).

**URL params:**
| Param | Effect |
|-------|--------|
| `?force=true` | Bypasses invocation lock, time window checks, and per-user daily claim |
| `?dry_run=true` | Returns JSON of what would be sent; no emails fired |
| `?test_to=email` | Redirects all emails to this address |
| `?test_user=email` | Only processes this one user (skips all others) |

### Actions dispatched via request body

**`action: 'invite'`**
Sends an invitation email to a new contractor. Generates a password-recovery link server-side (24-hour expiry) so no raw password is ever sent.

**`action: 'timesheet_submitted'`**
Sends a manager approval email when a contractor submits. Creates a tokenised approve/reject link (7-day, single-use). Body includes: contractor name, week ending, project, total hours, approve/reject buttons linking to `APP_URL?email_action={approve|reject}&token={token}`.

**`action: 'process_approval'`**
Validates a manager's email approval token. Checks: token exists, not used, not expired, timesheet still `pending`. Applies `approved` or `rejected` status and marks token as used.

### Reminder schedule logic

1. **Invocation lock** (bypassed by `?force=true`): atomic INSERT into `system_settings` with key `reminder_invocation_lock_{YYYYMMDDHH}`. One slot per UTC hour. Concurrent calls from pg_net queue flush are blocked here.

2. **Poller freshness check**: reads `system_settings.poller_last_run`. At hour 9: if poller age > 45 minutes, defer with `action: 'deferred (poller_age=Nm)'`. At hour 11: fires regardless (safety fallback). This prevents reminding contractors who just submitted by email but whose submission hasn't been processed yet.

3. **Reply-pending flags**: batch-loads all `reply_yes_pending_{userId}` keys from `system_settings`. Suppresses Monday reminders for 72h for users whose YES reply was classified. Belt-and-suspenders for the auto-submit flow.

4. **Per-user loop**: for each `timesheetuser` with `start_date` and `reminders_enabled != false`:
   - Determine local time using `tzMap` (country + region → IANA timezone)
   - **Friday 5pm local** (`dow=5, hour 17-18`): send "friendly" reminder
     - Pattern detection: if contractor has 3+ consistent approved weeks (max−min ≤ 4h) and is NOT portal-only (`source='direct'` for all recent weeks), add "Reply YES to submit same hours" as option 1 in email
     - Portal-only submitters are suppressed from the reply CTA (they should use the portal)
   - **Weekday 9am or 11am local** (`dow 1–5, hour 9 or 11`): send "urgent" reminder for each overdue week
   - Skip if nothing missing for that user
   - Atomic per-user daily claim (INSERT on `system_settings`) before sending — if claim fails (unique violation), already sent today → skip

5. **Manager reminders**: Mon–Fri 9am, for each manager with pending timesheet approvals for their team.

6. **Accountant section**: **currently disabled** (skipped with `action: 'skipped (disabled)'`). Covered by `send-timesheet-report` instead.

### Time window note

Time windows use `hour >= 9 && hour <= 10` (not exact hour) to tolerate cron delays. The actual fire logic is `hour === 9 || hour === 11` — no reminder fires at hour 10. The morning window has a poller freshness check at hour 9 and unconditional fire at hour 11.

### `getMissingWeeks()` logic

```
start = contractor's start_date (rounded to Monday)
limit = this week's Monday (for weekday 9am reminders)
      = this week's Monday (inclusive, for Friday 5pm)
cap at end_date: getMissingWeeks never flags weeks after contract end
return: all Mon-keyed weeks between start and limit not in submitted set
```

`REMINDER_CUTOFF = '2026-04-27'` — weeks before this date are never included in reminders (configured in edge function source).

### Email content

Three submission options offered in every reminder:
1. Reply YES to this email (if pattern detected)
2. Submit via portal: `https://time.mysynergie.net`
3. Reply with attachment
4. Direct email to `timesheets@mysynergie.net`

First-login note directs to `helpdesk@synergietechsolutions.com`.

Friday reminder subject includes the week ending date: `Timesheet Reminder — Week ending {Sunday date}`. This is how the reply classifier in the poller knows which week the YES reply refers to.

### Gotchas

- The `tzMap` in this file and in `TimesheetSystem.tsx` must be kept in sync. Both are hardcoded.
- Friday 9am + 5pm same-day claim conflict: a contractor with overdue past weeks gets a 9am urgent send which writes the daily claim; the 5pm friendly send finds the claim taken and is skipped. This is accepted — better one email than two.
- `?force=true` does NOT bypass `INVOCATION_EMAIL_CAP = 80`. For a bulk re-send exceeding 80 users, add a check to the cap.
- Brevo free plan cap: 300 emails/day. With ~65 contractors, a Friday afternoon + Monday morning = up to 130 sends. Upgrade to Brevo Starter if hitting limits.

---

## `send-timesheet-report`

**Purpose:** Generates a per-week missing-timesheet summary and emails it to accounting after each poller run.

**Method:** POST

**Auth:** `x-ingest-secret` header (same secret as `ingest-timesheet`).

**Trigger:** Called by the poller at end of each run when `created + corrections + autoSubmitted > 0`.

**Response:**
```json
{ "submitted": 42, "total": 65, "missing": 12 }
```

### Key logic

**Weeks covered:** All completed weeks since `CUTOFF = '2026-04-27'`. A week is "completed" on the following Monday. Current week appears in the timeliness table (Fri/Sat/Sun only) but never as a detail card — it's too noisy before the week ends.

**Eligibility:** Only `timesheetuser` role. Test accounts (name contains "hotmail", "yahoo", or "test") excluded. Duplicate names deduplicated. Filtered by `start_date <= weekSunday` AND `(!end_date || end_date >= weekStart)`.

**Report content:**
1. **Timeliness table** (last 6 completed weeks + current week if Fri/Sat/Sun):
   - Columns: Week, Total, Portal, Email, Fwd, Auto-YES, ≤1 day %, ≤3 days %, Avg days
   - Portal = `source='direct'` with no log entry; Email = has email_import_log row with matching emails; Fwd = `from_email != resolved_email` in log; Auto-YES = `message_id LIKE 'reply-yes-%'`
   - Color-coded: ≤1d ≥50% green, ≤3d ≥90% green
2. **Summary table** of all weeks with missing contractors
3. **Per-week detail cards** (only for completed weeks with missing contractors — never current week):
   - Missing names as colored chips
   - Changes note: new starters and newly inactive contractors this week

**Subject:** `"Timesheet Report — {N} Week{s} Outstanding"` or `"Timesheet Report — All Weeks Submitted ✓"`

**No guardrails:** `send-timesheet-report` has no invocation lock or daily dedup. The poller is the only caller; GitHub Actions serializes runs, so no burst risk. It is designed to fire on every qualifying poller run.

**Changes note:** Each week card shows new starters and newly inactive contractors to help accounting understand roster changes. New starters = `start_date >= weekStart && start_date <= weekSunday`. Newly inactive = `end_date >= weekStart - 7 && end_date < weekStart`.

### Channel classification logic

```
email_import_log join on timesheet_id:
  message_id starts with 'reply-yes-' → auto_yes
  from_email != resolved_email        → forwarded
  log row exists, emails match        → direct (email)
no log row, source='direct'           → portal (default in buildTimingSection)
```

Note: This channel classification is reliable from 2026-06-12 when the `from_email` bug was fixed. Before that, `from_email` was always the contractor's email even for forwarded submissions, so the forwarded channel count was always 0.

### Gotchas

- The eligibility filter in `buildTimingSection` must match the eligibility filter in the main weekly loop. Any discrepancy produces timeliness counts that don't match the missing/submitted totals.
- Current week is shown in the timeliness table on Fri/Sat/Sun (for early adopters who submit before the week ends) but is never a detail card. On Monday it becomes a completed week and is handled normally.

---

## `create-user`

**Purpose:** Creates a new `auth.users` record and `profiles` row. Required because public signups are disabled.

**Method:** POST

**Auth:** Bearer JWT. Verifies that caller is `role='admin'` in `profiles`.

**Request body:**
```json
{
  "email": "string (required)",
  "password": "string (required)",
  "name": "string (required)",
  "role": "timesheetuser | manager | accountant | vendormanager | admin",
  "country": "US",
  "region": "",
  "manager_id": "uuid | null",
  "project_id": "uuid | null",
  "start_date": "YYYY-MM-DD | null",
  "end_date": "YYYY-MM-DD | null",
  "phone": "string | null",
  "email_approvals_enabled": false,
  "invoice_enabled": false,
  "reminders_enabled": true,
  "vendor_manager_id": "uuid | null"
}
```

**Response:** `{ "userId": "uuid" }` or error.

**Logic:** Checks for existing profile by email (409 if exists). Creates `auth.users` with `email_confirm: true` (no verification email). Creates `profiles` row. If profile insert fails, deletes the auth user (rollback). Normalises email to lowercase.

**Why it exists:** `supabase.auth.signUp()` is blocked when `disable_signup: true`. The admin form in the frontend calls this edge function instead. The service role key allows bypassing signup restrictions.

---

## `impersonate-user`

**Purpose:** Admin generates a one-time magic link for any target user, allowing the admin to log in as that user in a new tab without affecting their own session.

**Method:** POST

**Auth:** Bearer JWT. Verifies caller is `role='admin'`.

**Request body:** `{ "userId": "uuid" }`

**Response:** `{ "url": "https://supabase.co/auth/v1/..." }` (the action link)

**Logic:** Looks up target user's email via `auth.admin.getUserById`. Generates a `magiclink` type link with `redirectTo: APP_URL`. Frontend opens this URL in a new tab.

**Security note:** The magic link is one-time use and expires per Supabase default settings (24 hours as of 2026-06-02 config change). The admin's own session is completely unaffected. The link is never stored in the DB.

---

## `trigger-poller`

**Purpose:** Bridge between pg_cron (which calls edge functions via `net.http_post`) and GitHub Actions (which runs the poller).

**Method:** POST

**Auth:** Deployed with `--no-verify-jwt`. pg_cron sends `apikey` header only (not a full JWT — JWT verification would always fail here).

**Logic:** Calls GitHub API `POST /repos/{owner}/{repo}/actions/workflows/poll-timesheets.yml/dispatches` with `{"ref": "main"}`. Uses `GITHUB_PAT` secret (classic PAT, workflow scope, no expiry).

**Schedule:** pg_cron job 7: `28 * * * *` (28 minutes past every hour)

**Why pg_cron instead of GitHub scheduled cron:** GitHub Actions cron was lagging 3–28 hours on this low-activity repo. pg_cron fires at the exact scheduled second.

**Important:** `poll-timesheets.yml` has its `schedule:` trigger **disabled** — only `workflow_dispatch` remains. Do not re-enable the schedule trigger — it would double-fire.

To pause the poller: `SELECT cron.unschedule(7);`
To resume: `SELECT cron.schedule('trigger-poller', '28 * * * *', $$SELECT net.http_post(url:='...', ...)$$);`

---

## `ingest-invoice`

**Purpose:** Receives parsed invoice data from the poller and inserts into the `invoices` table.

**Method:** POST

**Auth:** `x-ingest-secret` header (same as `ingest-timesheet`).

**Key rules:**
- **Forwarder gate:** `forwardedBy` must be present. Direct contractor submissions (`!forwardedBy`) are rejected with `direct_invoice_not_accepted`. This ensures accounting validates every invoice before it enters the DB.
- **No auto-create users:** Rejected with `unknown_contractor` if email not in `profiles`.
- **Status:** All ingested invoices land as `status='submitted'`. Never auto-approved.
- **Correction detection:** `correctionHint=true` (from email subject keywords) bypasses the `isDuplicate` check, forcing a replacement even if numbers are unchanged.
- **Hours derivation:** If `totalHours` is null (amount-only invoice), queries approved timesheets for the period and stores the sum as derived hours.

See invoice-pipeline.md for the full ingestion flow.
