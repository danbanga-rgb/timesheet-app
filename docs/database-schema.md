# Database Schema — Synergie Timesheet System

> Last brought current 2026-08-11 by querying `information_schema.columns` directly. Supabase project `mimlatvdwxqtgxrgcins`, schema `public`.

**Table catalog (19 total):**

| Domain | Tables |
|---|---|
| Core | `profiles`, `projects`, `timesheets`, `invoices`, `payment_profiles` |
| Ingest logs | `email_import_log`, `email_invoice_log`, `parser_shadow_log` |
| Convera / Payments | `convera_beneficiaries`, `convera_transactions`, `convera_transaction_invoices`, `import_batches` |
| Client Invoicing | `clients`, `client_engagements`, `hour_overrides` |
| QuickBooks Integration | `qb_sync_jobs`, `qb_wc_sessions` |
| Ops | `system_settings`, `system_alerts_state` |

---

## Core

### `profiles`
Extends `auth.users`. Every contractor / manager / accountant / admin has one.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | matches `auth.users.id` |
| `username` | text | login-friendly |
| `name` | text | display name |
| `role` | text | `timesheetuser` / `manager` / `accountant` / `vendormanager` / `admin` |
| `email` | text | login email; unique |
| `country` | text default `'US'` | for tzMap + reminders |
| `region` | text | US state / UK region / etc — refines timezone |
| `project_id` | int → projects.id | default project assignment |
| `manager_id` | uuid → profiles.id | approval routing |
| `vendor_manager_id` | uuid → profiles.id | scoped view |
| `start_date` / `end_date` | date | contractor lifecycle bounds all views + reminders |
| `phone` | text | |
| `invoice_enabled` | bool default true | (create-user path defaults to `false` since 2026-08-10) |
| `reminders_enabled` | bool default true | admin toggle to silence per user |
| `email_approvals_enabled` | bool default false | for the unwired per-timesheet email-approval flow |
| `imported_password` | text | legacy migration; not used at login |
| `payment_terms` | varchar | `NET15` / `NET30` / `NET45` / `NET60` — profile default |
| `invoice_template` | text | `regex` / `claude_vision` / null / `claude_full` — routes `extractInvoice()` |
| `location_type` | text | onshore / offshore — drives GNW $20/hr discount rule |
| `created_at` | timestamptz default now() | |

### `projects`
| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `name` | text | |
| `code` | text | display code |
| `status` | text default `'active'` | filter for active/inactive |
| `description` | text | |
| `created_at` | timestamptz | |

### `timesheets`
| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | uuid → profiles.id | |
| `user_name` | text | denormalized for report speed |
| `project_id` | int → projects.id | |
| `week_start` | date | **always Monday**; unique `(user_id, week_start)` |
| `entries` | jsonb default `'{}'` | `{YYYY-MM-DD: number}` or `{YYYY-MM-DD: {hours, isHoliday, ...}}` — see SHAPE-TRAP note |
| `status` | text default `'pending'` | `pending` / `approved` / `rejected` |
| `source` | text default `'direct'` | `direct` (portal) or `imported` (email); drives correction rules |
| `submitted_at` | timestamptz default now() | |
| `approved_at` | timestamptz | |
| `approved_by` | text | `'self-submit'` for no-manager auto-approve |
| `locked_days` | timestamptz[] | days locked by an approved invoice period; blocks re-submission. **Bug fixed 2026-07-08** (`2847e9a`) — was compared to date strings, every lock had been theater |
| `verified_zero_hours` | bool default false | true = confirmed LOA/PTO/sick; monitored by SLO `zero_hour_timesheet` |
| `verified_zero_hours_by` | uuid → profiles.id | admin who verified (null if auto-set via internal-forwarder path) |
| `verified_zero_hours_at` | timestamptz | |
| `verified_zero_hours_note` | text | free-form reason |

**Entries shape gotcha:** two readers still assume `{hours}`-object shape and silently drop plain-numbers ([[project_entries_shape_latent_bugs]]). Neither fires today. SHAPE-TRAP comments in the code point at `getHours()` in `send-timesheet-report:98`.

### `invoices`
| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | uuid → profiles.id | |
| `user_name` | text | |
| `project_id` | int → projects.id | |
| `invoice_number` | text default `''` | contractor's invoice #; used for matching + display |
| `period_start` / `period_end` | date | billing period |
| `lines` | jsonb default `'[]'` | `[{weekEndingFri, hours, rate, amount, ...}]` |
| `total_hours` / `rate` | numeric | |
| `total_amount` | numeric | primary $ field |
| `currency` | text default `'USD'` | |
| `status` | text default `'submitted'` | `submitted` / `approved` / `rejected` / `paid` / `flagged` |
| `payment_profile` | jsonb | snapshot of `payment_profiles` at approval time |
| `payment_terms` | varchar | invoice-level override of profile default |
| `payment_method` | text | Intuit (US default) / Convera (default all other) / manual override |
| `pay_on_date` | date | auto-computed from `period_end` + `payment_terms` |
| `paid_date` | date | locks the invoice from further edits |
| `attachment_path` | text | Supabase Storage bucket `invoice-attachments` |
| `submitted_at` / `reviewed_at` | timestamptz | |
| `reviewed_by` | text | |
| `notes` | text | |
| `is_vendor_invoice` | bool | vendormanager scope |
| `vendor_manager_id` | uuid → profiles.id | |
| `source` | text default `'direct'` | `direct` = frontend-created; `imported` = email-parsed |
| `reconciliation_status` / `reconciliation_delta` / `reconciliation_notes` | text/float/text | vs approved timesheets |
| `group_key` | text | groups multi-contractor umbrella payments |
| `corrected` | bool default false | re-submitted with different values |
| `matcher_ignore` | bool default false | fences pre-Submitted→Approved→Paid legacy from matcher (cutoff 2026-04-28) |
| `qb_export_status` | text default `'not_exported'` | `not_exported` / `exported_bill` / `bill_confirmed` |
| `qb_export_status_at` | timestamptz | |
| `qb_bill_txn_id` | text | QB TxnID once accountant confirms in QB |
| `edit_history` | jsonb default `'[]'` | JSON array of period-edit events (2026-07-28) |
| `created_at` | timestamptz | |

### `payment_profiles`
Bank / company details attached to invoices; snapshot copied into `invoices.payment_profile` on approval.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | uuid → profiles.id | one contractor can have many |
| `profile_name` | text | user-facing label (e.g. "Bimosoft UK ALT") |
| `company_name` / `company_address` | text | on-invoice recipient |
| `country` | text | 2-letter ISO |
| `bank_name` / `bank_address` / `bank_branch` | text | |
| `account_number` / `iban` / `swift` | text | IBAN lives in `iban` here; note `convera_beneficiaries` puts IBAN in `bank_account` |
| `payment_email` | text | contractor's preferred email for payment confirmations |
| `is_default` | bool default false | one per user shown first |
| `combine_payments` | bool | send as one wire when multiple profiles share same beneficiary |
| `convera_beneficiary_id` | int → convera_beneficiaries.id | link for auto-matching |
| `convera_match_override` | bool default false | manual pin — Bimosoft UK ALT guardrail uses this |
| `qb_vendor_name` | text | maps to QB vendor for Bills/Payments export |
| `created_at` | timestamptz | |

---

## Ingest Logs

### `email_import_log`
One row per email the poller processes. **Every email produces exactly one entry as of 2026-08-11** — no silent drops. See [edge-functions.md](edge-functions.md#email_import_logparse_status-vocabulary) for the full `parse_status` vocabulary (15 statuses).

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `received_at` | timestamptz default now() | |
| `message_id` | text | unique-ish; per-attachment logOnly uses `${msgId}::${att.name}` |
| `from_email` | text | actual sender (or forwarder) |
| `resolved_email` | text | actual contractor (differs when forwarded) |
| `subject` | text | |
| `body_preview` | text | first ~500 chars |
| `attachment_name` | text | |
| `parse_status` | text | 15 possible values — see edge-functions.md |
| `parse_notes` | text | |
| `user_id` | uuid | resolved contractor |
| `user_created` | bool default false | always false — auto-create disabled |
| `timesheet_id` | bigint | linked timesheet if created |
| `week_start` | text | resolved week |
| `raw_hours` | jsonb | as-parsed entries |
| `total_hours` | numeric | |
| `contractor_name` | text | |
| `attempt_count` | int default 1 | |
| `run_id` | text | UUID per poller invocation |

**Dropped 2026-08-11:** `forwarded_to` — was never written by any code, confirmed dead.

### `email_invoice_log`
Same idea but for invoices. Separate table.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `created_at` | timestamptz default now() | |
| `message_id` | text | unique |
| `from_email` | text | |
| `subject` | text | |
| `attachment_name` | text | |
| `attachment_hash` | text | dedup on same file re-sent |
| `parse_status` | text | |
| `parse_notes` | text | |
| `user_id` | uuid | |
| `invoice_id` | bigint | linked invoice |
| `period_start` / `period_end` | text | (**text**, not date — historical) |
| `raw_extracted` | jsonb | snapshot of parser output |
| `groq_vision_verification` | jsonb | shadow verification pass ([[project_groq_vision_layer]], currently broken) |
| `attempt_count` | int default 1 | |

### `parser_shadow_log`
Shadow-run log for parser experiments. Compares prod vs shadow implementations without side effects.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `at` | timestamptz default now() | |
| `kind` | text | e.g. `invoice_extract`, `week_resolve` |
| `source` | text | `poller` / `edge_fn` / etc |
| `reference_id` | bigint | linked row in prod table |
| `file_path` / `filename` | text | |
| `prod_result` / `shadow_result` | jsonb | |
| `signals` / `agreement` / `tiebreak_result` | jsonb | |
| `disagreement_severity` | text | `low` / `medium` / `high` |
| `disagreement_summary` | text | |
| `alerted_at` / `alert_reason` | timestamptz / text | |

---

## Convera / Payments

### `convera_beneficiaries`
| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `beneficiary_id` | text | Convera's ID |
| `short_name` | text | maps to `payment_profiles.profile_name` for auto-link |
| `beneficiary_name` | text | full display |
| `beneficiary_country` | text | 2-letter |
| `currency` | text | |
| `default_payment_method` | text | |
| `vendor_id` | text | |
| `bank_name` / `bank_country` / `bank_account` | text | **IBAN is in `bank_account`** — `iban_unique` is a boolean flag, not the IBAN itself |
| `iban_unique` | bool | true if not shared across contractors (LT Revolut shared by 24, IE Revolut by 9 — see [[reference_convera_export]]) |
| `updated_by` / `updated_date` | text | |
| `imported_at` | timestamptz | |
| `deprecated` | bool default false | soft-delete for old beneficiaries |
| `deprecated_reason` / `deprecated_at` | text/timestamptz | |
| `replacement_beneficiary_id` | int | redirect target |
| `force_combine` | bool default false | umbrella beneficiaries always group in Convera batch (Bimosoft UK ALT case) |

### `convera_transactions`
Inbound payment records from Convera CSV exports.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `confirmation_number` | text | Convera wire confirmation — grouping key for QB payments IIF |
| `line_item` | int | line within a batch |
| `date_of_order` | date | |
| `beneficiary_name` | text | |
| `subtotal` / `service_charges` / `grand_total` / `foreign_amount` | numeric | |
| `item_type` | text | |
| `ref1` | text | e.g. `INV 123` (never `Inv#`) — feed to `normaliseRef`, don't regex-parse |
| `convera_beneficiary_id` | int → convera_beneficiaries.id | routing key. **Not** snap IBAN (2026-08-10 finding, [[project_convera_transactions]]) |
| `import_batch_id` | int → import_batches.id | |
| `matched_invoice_id` | int → invoices.id | primary match (many-to-many also lives in `convera_transaction_invoices`) |
| `match_state` | text default `'unreviewed'` | `unreviewed` / `auto` / `manual` / `no_invoice` |
| `match_confidence` | text | `strong` / `weak` (weak = level ≥ 3) |
| `match_level` | int | 1–5 (see [[project_payment_matching_logic]]) |
| `matched_at` / `matched_by` | timestamptz / text | |
| `notes` | text | |
| `matcher_ignore` | bool default false | fences legacy from matcher (cutoff 2026-06-20) |
| `qb_payment_export_status` | text default `'not_exported'` | |
| `qb_payment_export_status_at` | timestamptz | |
| `qb_billpmt_txn_id` | text | (aspirational — QBO doesn't support BILLPMT, but shipped for QBD upgrade path) |

### `convera_transaction_invoices`
Many-to-many join. One Convera transaction can pay multiple invoices (umbrella payments).

| Column | Type | Notes |
|---|---|---|
| `transaction_id` | int → convera_transactions.id | PK part 1 |
| `invoice_id` | int → invoices.id | PK part 2 |
| `amount_share` | numeric | dollar amount attributed to this invoice |

### `import_batches`
Every CSV/XLS import creates a batch row so imports can be undone or audited.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `source` | text | `convera_transactions` / `qb_txn_detail` / etc |
| `source_filename` | text | |
| `imported_at` | timestamptz default now() | |
| `imported_by` | text | admin user |
| `row_count` | int | |
| `state` | text default `'pending'` | `pending` / `applied` / `reverted` |

---

## Client Invoicing

### `clients`
| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `name` | text | |
| `bill_to_name` / `bill_to_attn` | text | invoice header |
| `address_line1` / `address_line2` / `city` / `state` / `zip` | text | |
| `po_number` | text | |
| `payment_terms_days` | int default 30 | drives client invoice `pay_on_date` |
| `sales_tax_rate` | numeric default 0 | |
| `retention_credit_pct` | numeric default 0 | percentage held back |
| `retention_per_hour` | numeric default 0 | fixed $/hr retention |
| `investment_credit_running` | numeric default 0 | running total (Genworth) |
| `show_investment_credit_running_total` | bool default false | display in invoice footer |
| `invoice_format_type` | text default `'apfm'` | drives template selection (`apfm` / `ae` / `genworth`) |
| `created_at` / `updated_at` | timestamptz | |

### `client_engagements`
Assigns a contractor (`user_id`) to a client at a specific bill rate for a period.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `client_id` | int → clients.id | |
| `user_id` | uuid → profiles.id | |
| `role_title` | text | e.g. "Senior Engineer" |
| `sow_reference` | text | Statement of Work ref |
| `bill_rate` | numeric | $/hr to client |
| `effective_from` / `effective_to` | date | window; `to` null = active |
| `created_at` | timestamptz | |

### `hour_overrides`
Accountant edits to hours per engagement per week when the raw timesheet doesn't match what should be invoiced.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `engagement_id` | int → client_engagements.id | |
| `week_start` | date | |
| `hours_override` | numeric | |
| `note` | text | reason |
| `edited_by` | uuid → profiles.id | |
| `edited_at` | timestamptz | |

**GOTCHA:** this table exists in production but has **no migration file** in the repo. If restoring from schema-only pg_dump the table will be missing. See [[project_client_invoicing]].

---

## QuickBooks Integration

### `qb_sync_jobs`
Job queue for the QB Web Connector qbXML flow (in-flight — Chunks 2, 3, 4·Session 1 committed on branch `qb-web-connector-chunk2-builders`).

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `kind` | text | e.g. `bill_add`, `bill_query`, `bill_payment_check_add` |
| `payload` | jsonb | job-specific inputs |
| `depends_on` | bigint[] default `'{}'` | job DAG |
| `status` | text default `'pending'` | `pending` / `running` / `succeeded` / `failed` |
| `qbxml_request` | text | outgoing SOAP body |
| `qbxml_response` | text | QB's reply |
| `error_msg` | text | |
| `created_at` / `started_at` / `completed_at` | timestamptz | |

### `qb_wc_sessions`
Session tracking for QuickBooks Web Connector SOAP handshake.

| Column | Type | Notes |
|---|---|---|
| `ticket` | text PK | session token issued by `authenticate()` |
| `started_at` / `last_seen_at` | timestamptz default now() | |
| `job_id` | bigint → qb_sync_jobs.id | current job being served |
| `qb_company` | text | QB company file identifier |

---

## Ops

### `system_settings`
Key/value store for cross-run coordination. Everything from feature flags to atomic locks lives here.

| Column | Type | Notes |
|---|---|---|
| `key` | text PK | |
| `value` | text | JSON-encoded when structured |
| `updated_at` | timestamptz default now() | |

**Well-known keys:**
- `poller_last_run` — JSON `{ran_at, run_id, counts}` heartbeat
- `reminder_invocation_lock_{YYYYMMDDHH}` — hourly guard against pg_net flush duplicates
- `reminder_user_{YYYYMMDD}_{userId}` — per-user daily send claim
- `reply_yes_pending_{userId}` — 72h suppressor after YES reply
- `auto_reply_sent_{userId}` — rate-limit on auto-reply-B (YES no history)

### `system_alerts_state`
Per-SLO alert state for `monitor-health` cron.

| Column | Type | Notes |
|---|---|---|
| `slo_key` | text PK | e.g. `poller_heartbeat`, `zero_hour_timesheet` |
| `last_breached_at` | timestamptz | |
| `last_alerted_at` | timestamptz | for cooldown |
| `consecutive_breaches` | int default 0 | some SLOs require ≥ N consecutive breaches before firing (e.g. `poller_heartbeat` = 2, `e1e4854`) |

---

## Notable RPCs (SECURITY DEFINER)

| RPC | Purpose |
|---|---|
| `profile_email_exists(email)` | Sender allowlist check. Fail-open on error. Called by poller Layer 1 defence. |
| `find_profile_by_first_name(first)` | Match Intuit/QB filename contractor name to profile. Case-insensitive, unaccent. |
| `find_profile_by_name(name)` | Full-name match with `unaccent(lower())`. Used in name-word fallback resolution. |
| `find_profiles_by_name_words(words[])` | Multi-word capitalised-token subject fallback. |

---

## Correction Rules (source-of-truth summary)

Applied by `ingest-timesheet` when a timesheet is upserted:

| Existing | Incoming | Result |
|---|---|---|
| none | any | `create`, `status='approved'`, `source='imported'` |
| `source='direct'` (portal) | `forwardedBy=null`, same hours | `duplicate` — no change |
| `source='direct'` (portal) | `forwardedBy=null`, different hours | `correction_pending` — contractor can't reduce own hours; needs review |
| `source='direct'` (portal) | `forwardedBy` set | replace entries outright, `status='approved'` — accountant is authoritative |
| `source='imported'` | any | `mergeEntries()` max per day, keep `status='approved'` — handles month-end splits |
| any | `total=0` + valid week + contractor name | `success_zero_hours` (direct) or `success_zero_hours_forwarded`; latter auto-sets `verified_zero_hours=true` |
| any | `total=0` from `reply-yes-*` messageId | `auto_yes_zero_blocked` via sanity gate — refuses to submit |

Full detail: [[project_ingest_correction_rules]].

---

## Migration & Backup

- **Backup:** `.github/workflows/backup.yml` runs `pg_dump` on public schema at 2am UTC daily. Uploaded as GitHub Actions artifact with 30-day retention.
- **Restore:** artifacts are `.sql` files; drop-and-recreate against a Supabase project via `psql`. Note `hour_overrides` has no migration file, so schema-only restores need manual recreation.
- **Direct queries:** use Supabase Management API `POST /v1/projects/{ref}/database/query` with PAT ([[reference_supabase_pat]]).
