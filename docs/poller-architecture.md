# Poller Architecture — Complete Flow Reference

This document describes every significant code path in `scripts/poller/poller.js`. It exists because the poller has grown to handle many overlapping concerns and mistakes are expensive (missed submissions, duplicate emails, broken classifier flows). Read this before making changes.

---

## 1. Entry point & lifecycle

```
pg_cron :28 → trigger-poller edge fn → GitHub workflow_dispatch → poller.js
```

The poller runs once per hour. At the end of a run it:
1. Writes a heartbeat to `system_settings.poller_last_run` (used by `send-reminder` to detect stale runs)
2. Calls `sendSummaryEmail` if `actionable > 0`
3. Calls `triggerTimesheetReport` if timesheets were created/corrected/auto-submitted
4. Calls `sendInvoiceAccountingEmail` if invoices were ingested

**Critical:** `actionable` must count ALL activity types — timesheets, invoices, replies, failures. If a new result type is added to `summary`, it MUST be added to the `actionable` sum or the accounting email will never fire for runs where that's the only activity.

---

## 2. Email routing — the outer loop

Every unseen IMAP email enters the outer loop. The routing decision happens in this order:

```
1. DMARC report?           → delete, skip
2. hasTimesheetContent?    → processEmail() [handles attachments]
3. !hasTimesheetContent:
   a. isReply + weekStart parseable + Groq available + not internal + allowlisted?
      → classifyReply() → YES / MODIFY / NO branch
   b. else → forward to helpdesk
```

**Critical ordering:** The reply classifier (3a) MUST run before the helpdesk forward (3b). If a new `!hasTimesheetContent` block is added before 3a, it will silently intercept replies. The classifier was dead code for weeks because of exactly this mistake — a prior `!hasTimesheetContent` block forwarded to helpdesk and `continue`d before the classifier ran.

---

## 3. Reply classifier flow (Phase A AI agent)

```
isReply (subject starts "Re:") → parseWeekFromSubject() → weekStart
→ isKnownContractor(fromEmail) [SECURITY DEFINER RPC — anon key OK]
→ classifyReply(bodyText, fromName) [Groq llama-3.3-70b]
```

**Classification outcomes:**

| Intent | Action |
|--------|--------|
| YES | `fetchLastApprovedEntries` → `setReplyPendingFlag` → `autoSubmitFromReply` |
| MODIFY | push `reply_modify_pending` to timesheetReports, stop |
| NO / unclear | push `reply_no`, stop |

**`fetchLastApprovedEntries`:** Looks up profile by email, then most recent approved timesheet. Uses `CONFIG.supabaseServiceKey` — NOT the anon key. RLS blocks profile and timesheet reads with the anon key; it returns empty arrays silently, not errors.

**`setReplyPendingFlag`:** Writes `reply_yes_pending_{userId}` to `system_settings` with a timestamp. `send-reminder` reads these on Monday runs and suppresses reminders for 72h. This is a trust-building safety net — remove once YES flow has weeks of clean runs.

**`autoSubmitFromReply`:** POSTs to the `ingest-timesheet` edge function with `source='direct'`, `message_id='reply-yes-{uuid}'`. The `reply-yes-` prefix is what `send-timesheet-report` uses to classify channel as `auto_yes` in the timeliness table.

---

## 4. Timesheet processing — `processEmail()`

Only called when `hasTimesheetContent` is true. Handles XLSX, PDF attachments.

**Correction rules (enforced in `ingest-timesheet`, not the poller):**
- `source='direct'` + no forwarder → `correction_pending` (never auto-applied; contractor can't reduce own hours)
- `source='direct'` + internal forwarder → entries replaced outright, auto-approved (accountant is authoritative)
- `source='imported'` → max-merge per day (handles month-end partial-week splits)

**Summary results** go to `summary.timesheetReports` with fields: `action`, `contractorName`, `week`, `attachmentName`, `notes`. Every push to `timesheetReports` MUST use these field names — `sendSummaryEmail` reads them directly with `.padEnd` on `action`.

---

## 5. Key auth rules

| Operation | Key to use | Why |
|-----------|-----------|-----|
| SECURITY DEFINER RPCs (`profile_email_exists`, `find_profile_by_name`, etc.) | `SUPABASE_ANON_KEY` | RPCs bypass RLS by design; anon key is correct |
| Direct table reads (profiles, timesheets) | `CONFIG.supabaseServiceKey` | RLS blocks anon key; returns empty arrays silently |
| Direct table writes (system_settings) | `CONFIG.supabaseServiceKey` | Same reason |
| Ingest edge function | `CONFIG.ingestSecret` header | Custom auth, not Supabase key |

**Never use the anon key for a direct table read or write.** RLS will silently return `[]` rather than an error, making the bug look like missing data.

---

## 6. `summary` object — all fields

```javascript
summary = {
  created: 0,               // new timesheets ingested from attachments
  duplicates: 0,            // deduped via email_import_log
  corrections: 0,           // correction_imported results
  forwarded: 0,             // emails forwarded to helpdesk
  failures: [],             // { email, error, attemptCount }
  newUsers: [],             // unknown contractor emails (logged, not created)
  timesheetReports: [],     // reply classifier results: { action, contractorName, week, attachmentName, notes }
  invoiceReports: [],       // invoice parse results
}
```

`actionable` at end of main = `created + duplicates + corrections + forwarded + failures.length + newUsers.length + invoiceReports.length + timesheetReports.length`

`triggerTimesheetReport` fires when: `created + corrections + autoSubmitted > 0`
where `autoSubmitted = timesheetReports.filter(r => r.action === 'reply_yes_submitted').length`

---

## 7. Downstream effects of a successful ingest

```
ingest-timesheet upsert
  → email_import_log row (from_email, resolved_email, message_id, timesheet_id)
  → timesheets row (source, week_start, entries, status)

poller end-of-run (if actionable > 0):
  → sendSummaryEmail → helpdesk (plain text, per-run log)
  → triggerTimesheetReport → send-timesheet-report edge fn → accounting (HTML + CSVs)

send-timesheet-report channel classification:
  message_id LIKE 'reply-yes-%'           → auto_yes
  from_email != resolved_email             → forwarded  (reliable from 2026-06-12; backfilled before)
  log entry exists, emails match           → direct
  no log entry + source='direct'          → portal (default in buildTimingSection)
```

---

## 8. Reminder suppression

`send-reminder` (pg_cron, runs hourly) suppresses Monday reminders when:
1. Timesheet already submitted for the week (`missing.length === 0`)
2. `reply_yes_pending_{userId}` exists in `system_settings` with `created_at` within 72h

The pending flag is a belt-and-suspenders measure. Once YES flow has 2–3 weeks of clean runs, remove the flag-write from poller and the flag-check from send-reminder. The approved timesheet in the DB is sufficient.

---

## 9. Common failure modes & how to diagnose

| Symptom | Likely cause | Where to look |
|---------|-------------|--------------|
| YES reply not processed | Classifier not reached — check routing order | Outer loop, line ~3120 |
| YES processed but no history found | `fetchLastApprovedEntries` using wrong key | Check it uses `supabaseServiceKey` |
| No summary email after YES-only run | `timesheetReports.length` missing from `actionable` | End of `main()` |
| `padEnd` crash in sendSummaryEmail | `timesheetReports` push used wrong field names | Must use `action`/`contractorName`/`week` |
| Heartbeat not written | `supabaseServiceKey` missing from env | GitHub Actions secret `SUPABASE_SERVICE_ROLE_KEY` |
| Duplicate reminder emails | pg_net worker flush — invocation lock should catch | `system_settings.invocation_lock_*` |
