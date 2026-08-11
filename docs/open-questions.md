# Open Questions

> Last reviewed 2026-08-11.
> Closed items answered inline. Items in **Needs Dan** require product/accountant decisions or knowledge outside the codebase.

---

## Closed 2026-08-11 session

| # | Question | Resolution |
|---|---|---|
| 4 | Accountant reminder section — currently disabled | **Leave the skip in place** — Dan may re-enable a different accountant reminder later. Costs nothing to keep. |
| 8 | MODIFY flow for YES replies — surface to accountant? | **Leave as-is.** No one uses Auto-YES today (see [[project_auto_yes_unused]]). MODIFY UI is moot when nobody replies. Phase B may never happen. |
| 9 | Timesheet self-revocation grace window | **KILLED** — corrections flow covers the use case adequately. Memory updated. |
| 10 | Roster tab for accountant | **KILLED** — Consolidated tab + Import Log covers this. Don't build. |
| 13 | Boris Stupar Brevo suppression | Dan dropped the concern. Boris self-motivates fine (100% coverage since May 22 despite silent-blocked reminders). |
| 14 | Marinela April $450 short (invoice id=51 vs Convera OTR6588440) | **Assumed resolved.** 2 months stale; accountant would have raised if still open. |
| 15 | Enis Basic invoice id=79 wrong rate ($240) | **Assumed resolved.** Same reasoning as #14. |
| 19 | isTestAccount configurability | **Leave hardcoded.** Current substring filter ("hotmail" / "yahoo" / "test") works. No known slippage. |

---

## Closed pre-session (2026-08-11 doc pass)

| # | Question | Resolution |
|---|---|---|
| 1 | `email_invoice_log` schema | Confirmed separate table. Full column list captured in [database-schema.md](database-schema.md#email_invoice_log). |
| 2 | `ingest-invoice` edge function location | `supabase/functions/ingest-invoice/index.ts` — deployed. See [invoice-pipeline.md](invoice-pipeline.md). |
| 3 | `trigger-poller` edge function location | `supabase/functions/trigger-poller/index.ts` — deployed. pg_cron job 7 (`:28`) → workflow_dispatch on `poll-timesheets.yml`. |
| 6 | `convera_beneficiaries` schema | Confirmed. Has `currency`. `id` is `bigint`. Full detail in [database-schema.md](database-schema.md#convera_beneficiaries). |
| 11 | Holiday data for 2027 | Already present in `TimesheetSystem.tsx:716`. No action until 2028. |
| 16 | Oracle VM capacity | Saga CLOSED 2026-06-18. Not pursued. |
| 18 | `find_profile_by_name` vs `find_profile_by_first_name` | Both exist as separate RPCs. Both in production use. |
| 20 | pg-dump-backup destination | Workflow file is `.github/workflows/backup.yml` (not `pg-dump-backup.yml`). 2am UTC daily, `pg_dump` on public schema, GitHub Actions artifact, 30-day retention. |

---

## Confirmed as-is (documented, no action)

| # | Item | Status |
|---|---|---|
| 5 | `email_approval_tokens` table | **Does not exist in DB.** Referenced by dead code in `send-reminder` (`action: 'timesheet_submitted'`, `action: 'process_approval'`). Frontend never calls it. Dan chose "leave as-is" 2026-08-11; unwired comments added on both handlers. |
| 7 | `email_import_log.forwarded_to` column | **Dropped 2026-08-11** via Management API migration. |
| 17 | `SUPABASE_ANON_KEY` hardcoded in poller | Still hardcoded (`poller.js:67`). Public publishable key, not a secret. No security risk. Leaving as-is. |

---

## New / lingering (nothing pressing)

Nothing outstanding after the 2026-08-11 session pass. If new questions surface as work happens, add them here with a session date.
