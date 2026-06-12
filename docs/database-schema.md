# Database Schema Reference

> Generated 2026-06-12. May need review as the system evolves.

---

## Overview

All tables live in Supabase PostgreSQL (project `mimlatvdwxqtgxrgcins`). Column names are `snake_case`; TypeScript interface fields are `camelCase` — `normaliseTimesheet()` and similar functions map at fetch time.

---

## `profiles`

Extends `auth.users`. One row per user. Created by the `create-user` edge function (public signups disabled).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, FK → `auth.users.id` |
| `email` | `text` | Lowercase. Used for all contractor resolution lookups |
| `username` | `text` | Set to email at creation; not used for login |
| `name` | `text` | Display name. `ingest-timesheet` may update from email metadata if current name looks auto-generated (all lowercase, no space, matches email prefix) |
| `role` | `text` | `timesheetuser` / `manager` / `accountant` / `vendormanager` / `admin` |
| `country` | `text` | ISO 2-letter code (US, GB, CA, HR, RS, BA, SI, MK, IN, NL) |
| `region` | `text` | Free text region within country. Combined with country to look up timezone in `tzMap`. Admin sees warning icon for unknown combos |
| `manager_id` | `uuid` | FK → `profiles.id`. NULL = auto-approve on submit |
| `project_id` | `uuid` | FK → `projects.id`. Current project assignment. Historical consolidated reports use most-recent timesheet's project_id, not this column |
| `start_date` | `date` | When contractor started. All views, reminders, and reports are bounded by this date. `getMissingWeeks()` starts from here. **Must be updated (not just cleared) when a contractor returns after a gap** |
| `end_date` | `date` | When contractor ended. NULL = active. Reports and reminders stop at this date |
| `phone` | `text` | Optional. Profile completion banner prompts if missing |
| `invoice_enabled` | `bool` | Whether contractor can see invoice features. Default false |
| `reminders_enabled` | `bool` | Whether automated reminders are sent to this user. Default true. Admin can toggle. Set to false for users blocked in Brevo (e.g. spam complaint) |
| `email_approvals_enabled` | `bool` | Whether manager approval emails are sent. Default false |
| `vendor_manager_id` | `uuid` | FK → `profiles.id`. Links vendor contractors to their vendormanager |
| `payment_terms` | `varchar(10)` | Default payment terms: NET15 / NET30 / NET45 / NET60. Cascades from invoice on change. ~44 contractors have no history yet — accountant sets as invoices come through |

**RLS:** Row-level security is enabled. From the poller, always use SECURITY DEFINER RPCs (`profile_email_exists`, `find_profile_by_first_name`, `find_profiles_by_name_words`) for profile lookups — the anon key cannot read `profiles` directly and returns `[]` silently.

**Gotchas:**
- Never use `profiles.project_id` for historical reports. The column always reflects the current project; historical weeks before a project switch would retroactively show the new project.
- When a contractor leaves and returns: set a **new** `start_date` equal to their return date and clear `end_date`. Do NOT keep the original start_date — `getMissingWeeks()` starts from `start_date` and would generate reminders for the entire gap period.

---

## `timesheets`

One row per contractor per week. The core table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int8` | PK, auto-increment |
| `user_id` | `uuid` | FK → `profiles.id` |
| `user_name` | `text` | Snapshot of contractor name at submission time |
| `week_start` | `date` | Always a **Monday** in `YYYY-MM-DD` format. Never stored with time component |
| `entries` | `jsonb` | See entry shape below |
| `status` | `text` | See status values below |
| `source` | `text` | `'direct'` (portal) or `'imported'` (email/poller). Drives correction rules |
| `submitted_at` | `timestamptz` | When timesheet entered the system. Portal: exact submit time. Email: poller processing time (≤1h lag) |
| `approved_at` | `timestamptz` | When approved |
| `approved_by` | `text` | `'system-import'` for auto-approved imports; `'self-submit'` for no-manager portal submits; manager name/id for manual approvals |
| `project_id` | `uuid` | FK → `projects.id`. May be null for email-imported timesheets (falls back to `profiles.project_id` in UI) |
| `message_id` | `text` | Email message ID. Used for deduplication. Auto-submitted YES replies use prefix `reply-yes-{uuid}` |

### `timesheets.entries` JSON shape

```json
{
  "2026-05-25": { "hours": "8", "isHoliday": false, "holidayName": null, "isWeekend": false },
  "2026-05-26": { "hours": "8" },
  "2026-05-27": { "hours": "8" },
  "2026-05-28": { "hours": "8" },
  "2026-05-29": { "hours": "8" },
  "2026-05-30": { "hours": "0", "isWeekend": true },
  "2026-05-31": { "hours": "0", "isWeekend": true }
}
```

Keys are `YYYY-MM-DD` date strings (Monday through Sunday). All 7 days may or may not be present.

`hours` is always stored as a **string** in portal submissions. Email imports may store as number. `getHours()` in `send-timesheet-report` handles both: `typeof entry === 'number' ? entry : parseFloat(String(entry?.hours ?? 0))`.

Optional fields: `isHoliday` (bool), `holidayName` (string), `isWeekend` (bool).

### `timesheets.status` values and transitions

| Status | Meaning | Next states |
|--------|---------|------------|
| `pending` | Submitted by contractor, awaiting manager approval | `approved`, `rejected` |
| `approved` | Approved (by manager, by system-import, or self-submit with no manager) | `correction_pending` (if emailed correction received) |
| `rejected` | Rejected by manager or accountant | `pending` (if contractor resubmits) |
| `correction_pending` | Contractor emailed different hours for an already-approved portal submission | `approved` (after admin review) |

**Key rule:** `correction_pending` is never auto-resolved. It means a contractor sent different hours by email after a portal submission. An admin must review and manually apply or discard.

### Correction rules (enforced in `ingest-timesheet`)

| Incoming | Existing | Action |
|---------|---------|--------|
| Any source, no `forwardedBy` | `source='direct'` exists | → `correction_pending` (never auto-apply) |
| Any source, `forwardedBy` set | `source='direct'` exists | → replace entries outright, auto-approve. Accountant is authoritative and may reduce hours |
| `source='imported'` | `source='imported'` exists | → `mergeEntries()` max per day, keep `approved`. Handles month-end partial-week splits |
| Any | None exists | → create as `approved`, `source='imported'` |
| Identical hours | `source='direct'` exists, no `forwardedBy` | → `duplicate`, no change |

**Why outright replace for internal forwarder:** Accountants may need to reduce hours (e.g. contractor submitted 40h but only 16h are billable). Max-merge would silently ignore the reduction.

**Why max-merge for imported→imported:** Contractor may send Apr 27–30 in one email and May 1 in another. Both map to `week_start=2026-04-27`. Max-merge preserves the best of each day.

**Rolling multi-week file risk:** A contractor who submits a file spanning multiple weeks, where the earlier weeks had already been corrected to lower values, will overwrite those corrections on any day where the file has higher hours (max-merge wins). This is a known limitation.

---

## `invoices`

One row per contractor invoice.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int8` | PK |
| `user_id` | `uuid` | FK → `profiles.id` |
| `period_start` | `date` | Billing period start |
| `period_end` | `date` | Billing period end |
| `total_hours` | `numeric` | Total hours. May be null for amount-only invoices; system then queries timesheets to derive |
| `rate` | `numeric` | Hourly rate |
| `amount` | `numeric` | Invoice amount |
| `currency` | `text` | Always USD in practice. Non-USD = parsing failure, not a conversion |
| `status` | `text` | `submitted` / `approved` / `rejected` / `paid` |
| `source` | `text` | `'imported'` for email-ingested; never auto-approved |
| `payment_profile` | `jsonb` | Full snapshot of `PaymentProfile` object at time of approval. NOT a FK. Switching profiles replaces this snapshot. Keys are camelCase |
| `attachment_path` | `text` | Path in Supabase Storage bucket `invoice-attachments` |
| `payment_terms` | `varchar(10)` | NET15 / NET30 / NET45 / NET60. Overrides profile default. Cascade: change → writes back to `profiles.payment_terms` |
| `pay_on` | `date` | Calculated pay date (period_end + N days, rounded to next 15th or EOM, adjusted for weekends) |
| `reconciliation_status` | `text` | Stored at insert time and recomputed live from current timesheet state |
| `reconciliation_delta` | `numeric` | Hours difference between invoice and approved timesheets |
| `message_id` | `text` | Email message ID for deduplication |

**Note:** `payment_profile` is a full JSON snapshot, not a FK. Accountant can switch profiles via the "Switch" button in the invoice modal — this replaces the snapshot. No separate profile link table exists.

---

## `payment_profiles`

Bank/company details for a contractor. Multiple profiles per contractor (e.g. personal vs company account, or different IBANs).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int8` | PK |
| `user_id` | `uuid` | FK → `profiles.id` |
| `company_name` | `text` | Payee company name |
| `bank_name` | `text` | |
| `iban` / `account_number` | `text` | One or the other depending on country |
| `swift` / `sort_code` / `routing_number` | `text` | Routing details |
| `is_default` | `bool` | One default per contractor. Shown first in profile picker |
| `payment_terms` | `varchar(10)` | Per-profile default terms (also on `profiles`) |
| `convera_beneficiary_id` | `int8` | FK → `convera_beneficiaries.id`. Links to Convera payment system |

**IBAN gotchas (critical):** LT Revolut pool IBAN `LT633250056365211440` is shared by 24 contractors. IE Revolut pool `IE18REVO99036092001905` is shared by 9 contractors. IBAN matching alone cannot identify these contractors. Match by contractor name or `convera_beneficiary_id` instead.

---

## `projects`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `name` | `text` | Project display name |
| `code` | `text` | Short code used in reports |
| `status` | `text` | `active` / `inactive` |

---

## `email_import_log`

Audit log for every email the poller processes. One row per email-attachment pair (some emails have multiple attachments, generating multiple rows).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int8` | PK |
| `message_id` | `text` | IMAP message ID. Used for deduplication. See unique constraint below |
| `from_email` | `text` | **As of 2026-06-12:** the forwarder's email when `forwardedBy` is set; the contractor's email otherwise. Before this fix, `from_email` was always set to `contractorEmail` — the bug masked whether a submission was forwarded |
| `resolved_email` | `text` | Always the contractor's email (what was resolved from forwarded headers / attachment filenames) |
| `subject` | `text` | |
| `attachment_name` | `text` | |
| `parse_status` | `text` | `success` / `duplicate` / `correction` / `correction_pending` / `failed` / `partial` |
| `parse_notes` | `text` | Human-readable notes, including `[parseMethod]` prefix for invoice parsing |
| `user_id` | `uuid` | FK → `profiles.id`. NULL if unknown contractor |
| `user_created` | `bool` | Always false (auto-creation disabled) |
| `timesheet_id` | `int8` | FK → `timesheets.id`. Used by `send-timesheet-report` for channel classification |
| `week_start` | `date` | Resolved week Monday |
| `raw_hours` | `jsonb` | The parsed entry object before upsert |
| `attempt_count` | `int` | How many times this email has been processed (failed → deleted and retried) |
| `run_id` | `text` | UUID linking to a specific poller run. Query: `SELECT * FROM email_import_log WHERE run_id = '...'`. The run ID is in `system_settings.poller_last_run` |

**Deduplication trap:** Once `parse_status` is `success`, `duplicate`, `correction`, or `correction_pending`, the row is never reprocessed. If a submission needs to be re-ingested (e.g. after a parser fix), delete the log row first. Failed and partial statuses are retried automatically on next run (the old row is deleted and a fresh one inserted).

**Channel classification** in `send-timesheet-report`:
- `message_id LIKE 'reply-yes-%'` → `auto_yes`
- `from_email != resolved_email` → `forwarded` (reliable from 2026-06-12)
- Log entry exists, emails match → `direct`
- No log entry + `source='direct'` → `portal` (default fallback in `buildTimingSection`)

---

## `system_settings`

Key/value store for operational metadata and locks. Single-row per key.

| Key pattern | Value | Notes |
|-------------|-------|-------|
| `poller_last_run` | JSON: `{ran_at, run_id, created, duplicates, corrections, failures, forwarded, invoices}` | Written at end of every poller run. Used by `send-reminder` to detect stale runs (defer 9am reminder if age > 45min) |
| `reminder_invocation_lock_{YYYYMMDDHH}` | ISO timestamp | Hourly mutex. First concurrent invocation wins; others return `{skipped: 'duplicate_invocation'}`. Prevents pg_net queue flush bursts |
| `reminder_user_{YYYYMMDD}_{userId}` | ISO timestamp | Per-user daily claim. Atomic INSERT prevents double-send. Bypassed by `?force=true` |
| `reply_yes_pending_{userId}` | JSON: `{weekStart, created_at, email}` | Written when poller classifies a YES reply (before auto-submit). Suppresses Monday reminders for 72h as belt-and-suspenders. To be removed once YES flow has weeks of clean runs |

**Do not manually delete `reminder_invocation_lock_*` or `reminder_user_*` entries unless diagnosing an incident** — they expire naturally (one per day) and are harmless.

---

## `convera_beneficiaries`

One row per Convera payment beneficiary record.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int8` | PK |
| `short_name` | `text` | Convera-assigned alias (up to ~35 chars, truncated) |
| `beneficiary_name` | `text` | Legal payee name |
| `iban` | `text` | Bank account identifier |
| `bank_name` | `text` | |
| `currency` | `text` | Almost always USD |

163 records total (as of 2026-06-03). Imported from Convera export. Source of truth for contractor IBANs. The JSON file `scripts/poller/convera-beneficiaries.json` is gitignored (contains contractor banking data) — it's the local memory bank for re-imports.

**Matching:** Short-name prefix match using `norm(short_name).startswith(norm(contractor_name))`. Two known exceptions require manual overrides (Convera typo "Alexandar Brajkovic", different name "LIIA KHAUSTOVA" for Liya Haustova).

---

## `convera_transactions`

One row per line item in a Convera payment order. 138 rows covering Mar–Jun 2026.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int8` | PK |
| `confirmation_number` | `text` | Payment order confirmation |
| `line_item` | `int` | Line item within the order. Unique pair with `confirmation_number` |
| `date_of_order` | `date` | |
| `beneficiary_name` | `text` | As shown in Convera export |
| `subtotal` | `numeric` | |
| `service_charges` | `numeric` | |
| `grand_total` | `numeric` | |
| `item_type` | `text` | |
| `foreign_amount` | `numeric` | If paid in non-USD |
| `ref1` | `text` | |
| `convera_beneficiary_id` | `int8` | FK → `convera_beneficiaries.id`. 127/138 rows linked |

Upsert on `(confirmation_number, line_item)`. Safe to re-run the import script. 11 rows unlinked because the beneficiary is an intermediary (Native Teams Limited = 5 candidates; D-KODE = 2 candidates sharing a company).

Used by the Convera Matching modal in the accountant Invoices tab to show "last paid" date per contractor.

---

## `email_approval_tokens`

For manager email approvals (single-use tokenised links).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int8` | PK |
| `timesheet_id` | `int8` | FK → `timesheets.id` |
| `manager_id` | `uuid` | FK → `profiles.id` |
| `token` | `text` | UUID-based random token, 64 chars |
| `expires_at` | `timestamptz` | 7 days from creation |
| `used` | `bool` | One-time use. `used_at` recorded |
| `used_at` | `timestamptz` | |

---

## Notes on Missing Tables

- `invoice-attachments` — This is a **Supabase Storage bucket**, not a table. Invoices store the attachment path in `invoices.attachment_path`.
- `email_invoice_log` — Separate from `email_import_log`. Tracks invoice ingestion attempts with `parse_notes` containing `[parseMethod]` prefix. See invoice-pipeline.md for detail.
