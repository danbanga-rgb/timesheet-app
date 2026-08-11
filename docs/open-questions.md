# Open Questions

> Last reviewed 2026-08-11.
> Closed items answered inline. Items in **Needs Dan** require product/accountant decisions or knowledge outside the codebase.

---

## Closed since last review (2026-06-14)

| # | Question | Resolution |
|---|---|---|
| 1 | `email_invoice_log` schema | Confirmed separate table from `email_import_log`. Columns: `id, created_at, message_id, from_email, subject, attachment_name, parse_status, parse_notes, user_id, invoice_id, period_start, period_end, raw_extracted (jsonb), attempt_count, attachment_hash, groq_vision_verification (jsonb)`. |
| 2 | `ingest-invoice` edge function location | `supabase/functions/ingest-invoice/index.ts` — deployed. See docs/invoice-pipeline.md for shape. |
| 3 | `trigger-poller` edge function location | `supabase/functions/trigger-poller/index.ts` — deployed. pg_cron job 7 (`:28`) POSTs to it, which fires GitHub `workflow_dispatch` on `poll-timesheets.yml`. |
| 6 | `convera_beneficiaries` schema | Confirmed. Has `currency text nullable`. `id` is `bigint` (int8). Full columns: `id (bigint PK), beneficiary_id (text), short_name, beneficiary_name, beneficiary_country, currency, default_payment_method, vendor_id, bank_name, bank_country, bank_account, iban_unique (bool), updated_by, updated_date, imported_at, deprecated (bool), deprecated_reason, replacement_beneficiary_id, deprecated_at, force_combine (bool)`. |
| 11 | Holiday data for 2027 | Already present in `TimesheetSystem.tsx:716`. No action needed until 2028. |
| 16 | Oracle VM capacity | Saga CLOSED 2026-06-18. No longer pursued. |
| 18 | `find_profile_by_name` vs `find_profile_by_first_name` | Both exist as separate RPCs. Both in production use. |
| 20 | pg-dump-backup destination | Workflow file is `.github/workflows/backup.yml` (not `pg-dump-backup.yml`). Runs 2am UTC daily. `pg_dump` on public schema only. Uploaded as GitHub Actions artifact with 30-day retention. |

---

## Confirmed as-is (documented, no action)

| # | Item | Status |
|---|---|---|
| 5 | `email_approval_tokens` table | **Does not exist in DB.** Referenced by dead code in `send-reminder` (`action: 'timesheet_submitted'`, `action: 'process_approval'`). The tokenised per-timesheet manager approval feature was designed but never wired up from the frontend — `grep -r "timesheet_submitted" src/` returns nothing. Options: (a) remove the dead code, (b) create the table and wire up the frontend if the feature is still wanted. |
| 7 | `email_import_log.forwarded_to` column | **Dead column confirmed.** No writes in poller or any edge fn. Safe to drop, or repurpose. Recommend drop in next schema cleanup pass. |
| 17 | `SUPABASE_ANON_KEY` hardcoded in poller | Still hardcoded (`poller.js:67`). It's the public publishable key, not a secret. No security risk; only used for SECURITY DEFINER RPCs. Leaving as-is unless there's a specific reason to env-ify. |

---

## Needs Dan (product/accountant/judgment calls)

**4. Accountant reminder section — currently disabled.** Skipped with `action: 'skipped (disabled)'` in `send-reminder`. It's covered today by `send-timesheet-report`. The original logic was pre-`send-timesheet-report`; the disable was a deliberate replacement. **Question:** Delete the dead code entirely, or leave the skip in case you want to re-enable a *different* accountant reminder (not the report) later?

**8. MODIFY flow for YES replies.** Groq classifier can return `MODIFY` when a reply says "yes but with these changes". Today it's written to `summary.timesheetReports` as `reply_modify_pending` and shown only in the helpdesk summary email — nothing surfaces it to accounting/admin. **Question:** For Phase B, do you want a dedicated UI card in the admin Import Log for these, or is helpdesk-only fine?

**9. Timesheet self-revocation grace window.** Memory says PENDING accountant sign-off — Mon/Tue grace for contractors to revoke auto-approved portal submissions. **Question:** Did accountant sign off? If yes and it's not built, want it prioritized? If declined, want the memory entry updated?

**10. Roster tab for accountant.** Memory says "Roster tab (name/start/end/project)" is backlog. **Question:** Still wanted, or superseded by other visibility fixes?

**12. `INVOCATION_EMAIL_CAP = 80` in send-reminder.** With ~65 active contractors, current cap is a comfortable margin. A `?force=true` bulk resend after an outage would clip at 80 (managers + accountant queued after contractors could get skipped). **Question:** Bump to 150 now to future-proof, or leave until contractor count crosses 60?

**13. Boris Stupar spam block.** Memory says blocked in Brevo since May 22 spam complaint, all reminders silently dropped. Marked LOW PRI because he submits timely. **Question:** Still blocked? Want us to remove from suppression list, or leave as-is?

**14. Marinela April payment gap.** Invoice id=51 ($5,280) matched Convera OTR6588440 but only $4,830 paid — $450 short. **Question:** Was this reconciled with accountant / Convera? If not, worth chasing.

**15. Enis Basic invoice id=79.** Listed as wrong rate ($240); action was "verify PDF → UPDATE". **Question:** Was this corrected?

**19. `isTestAccount` filter — configurable?** Currently hardcoded: name contains "hotmail", "yahoo", or "test". Applied in `send-timesheet-report`, weekly views, consolidated views. **Question:** Any test accounts slipping through? Want a `profiles.is_test` boolean column instead, or is the hardcoded list fine?

---

## New questions raised during 2026-08-11 doc pass

**A. `email_approval_tokens` dead code — remove or complete?** See #5 above. If the per-timesheet manager approval flow was scrapped, cleaning up `send-reminder` would tighten the file. If not, the DB table needs to be created and the frontend wired up.

**B. AI agent doc is stale.** `docs/ai-agent.md` describes the LLM classifier that was ripped out on 2026-07-12 (commits `1344d77`, `ef274a3`). Current architecture is deterministic regex + HTML reply-header strip. **Question:** Want me to rewrite the doc to reflect the new deterministic pipeline, or leave a "deprecated — see MEMORY" note at the top and let the code speak?

**C. `system-overview.md` and `database-schema.md` last touched Jun 12.** They're stale on: `verified_zero_hours` columns, `matcher_ignore` fences, Client Invoicing MVP, Payments tab, QB IIF exports, Convera batch pipeline, most of what shipped in July. **Question:** Want a full refresh (~1-2 hours of doc work), or narrow updates as topics come up?
