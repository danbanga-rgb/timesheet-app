# Open Questions — Docs Review Iteration List

> Generated 2026-06-12. These are gaps, ambiguities, and items that need developer input to document accurately.

---

1. **`email_invoice_log` schema** — The docs reference this table (for invoice ingestion tracking, parse method, etc.) but its exact column list was not confirmed from source. What are the full columns? Is it a separate table from `email_import_log`, or did invoice logging get added to the same table with a `type` column?

2. **`ingest-invoice` edge function location** — The function is referenced in CLAUDE.md and memory files but `supabase/functions/ingest-invoice/` was not among the functions read. Is it deployed separately? What is the exact request/response shape? The invoice-pipeline.md docs were written from memory files only.

3. **`trigger-poller` edge function location** — Not read from source. Assumed to be `supabase/functions/trigger-poller/index.ts`. Confirm it exists and that the pg_cron SQL in database-schema.md accurately reflects the current deployed version.

4. **Accountant reminder section — currently disabled** — CLAUDE.md says the accountant reminder section in `send-reminder` is skipped with `action: 'skipped (disabled)'`. The source confirms this. The question is: what was the original logic, and was it removed from the code entirely or just skipped with a flag? When/if the accountant reminder is ever re-enabled, what should it do?

5. **`email_approval_tokens` table** — The schema was documented from reading the `send-reminder` source code. Is there anything else in this table (e.g., a `created_at` column, an index on `token`)? Is there any cleanup job for expired tokens?

6. **`convera_beneficiaries` schema** — The schema in database-schema.md was reconstructed from memory files. Confirm against the actual migration SQL. Specifically: is there a `currency` column, and is `id` an `int8` or something else?

7. **`email_import_log.forwarded_to` column** — The submission timeliness memory file mentions this column as "always null; never wired up in the poller. Dead column." Is it still in the DB schema? Should it be dropped or repurposed?

8. **MODIFY flow for YES replies** — When the Groq classifier returns `MODIFY`, a `reply_modify_pending` entry is written to `summary.timesheetReports`. Does anything in the current system surface this to accounting or admins? Or is it only visible in the helpdesk summary email? This needs a decision before Phase B is built.

9. **Timesheet self-revocation** — Memory file `project_timesheet_self_revocation.md` says this feature is "PENDING accountant sign-off: grace window until Mon/Tue for self-revocation of auto-approved portal timesheets." What is the current status? Has the accountant signed off? Was it ever built?

10. **Roster tab backlog** — `project_accountant_start_end_visibility.md` says a "Roster tab (name/start/end/project)" is in the backlog for accountant visibility into why contractors appear/disappear. Has this been built, or is it still pending?

11. **Holiday data for 2027** — `TimesheetSystem.tsx` has hardcoded holiday data for 2026. When does this need to be updated for 2027? Who is responsible for updating it?

12. **`INVOCATION_EMAIL_CAP = 80` in send-reminder** — With ~65 real contractors, this cap is fine now. But it means a `?force=true` bulk re-send after an outage would be capped at 80. Is the cap still 80? Should it be raised if the contractor count grows past 80?

13. **Boris Stupar spam block** — Memory file `project_boris_stupar.md` says he was blocked in Brevo since May 22 spam complaint and all reminder sends are silently dropped. Was this resolved (removed from Brevo suppression list or `reminders_enabled` set to false)?

14. **Marinela April payment gap** — Invoice id=51 ($5,280) matched to Convera OTR6588440 but only $4,830 paid — $450 short. Was this resolved with the accountant?

15. **Enis Basic invoice id=79** — Listed as having wrong rate ($240); action was "verify PDF → UPDATE". Was this corrected?

16. **Oracle VM capacity** — Oracle ARM VM instance creation was blocked by "Out of capacity" in all US-ASHBURN ADs as of 2026-06-11. Has capacity freed up? If not, are there alternative regions to try?

17. **`SUPABASE_ANON_KEY` hardcoded in poller** — `scripts/poller/poller.js` line 66: `const SUPABASE_ANON_KEY = 'sb_publishable_qYa4tmVYu2zsIZfUhvT7hg_UaGgAgKc'` — hardcoded, not from env. Is this intentional? It's the public anon key (not a secret), used only for SECURITY DEFINER RPCs. Should it be moved to an env var for consistency?

18. **`find_profile_by_name` RPC** — Referenced in `project_invoice_issues_backlog.md` as using `unaccent(lower(...))` for name matching. Is this the same as `find_profile_by_first_name` or a separate RPC? Is it still in use?

19. **Test account filter — `isTestAccount`** — Currently checks for "hotmail", "yahoo", or "test" in the name field. This is applied in `send-timesheet-report` and in the weekly/consolidated views. Are there other test accounts that this doesn't catch? Should the filter be configurable?

20. **pg-dump-backup.yml** — Listed as running daily but not documented. Where are the backups stored (S3 bucket, GitHub artifacts)? What is the retention policy? Who can access them?
