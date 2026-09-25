# Backlog: escalate missing offshore timesheets to Toni (>2 weeks)

**Status:** BACKLOG (Dan, 2026-09-25). Not started. Toni's email address: **TBD. Dan will provide it.**

## Why
All offshore (non-India) contractors come through **Toni**. He didn't want to be in the manager approval loop, so their timesheets are **auto-approved**. Side effect: when one of those contractors stops submitting, nobody on Toni's side hears about it. By two weeks the contractor has already had ~10 daily "urgent" reminders from `send-reminder`, so more email to the same person doesn't help. Toni needs to get involved.

## Rules (decided)
- **Recipient:** Toni only (email TBD).
- **Trigger:** **missing only**, i.e. no timesheet submitted for a week whose week-ending **Sunday** is **more than 14 days ago**. Submitted-but-unapproved is out of scope (they're auto-approved anyway).
- **People:** Toni's contractors = **offshore, non-India**. Dan: "It'll be important to scope to the right people."

## Scoping: verify before building (the critical part)
- Offshore = `profiles.location_type = 'offshore'`. **Never `country`.** ~18 offshore profiles carry `country='US'` wrongly (memory `project_profile_country_auto_detect_trap`).
- Non-India = `country <> 'IN'`. The wrongly-US offshore profiles still count as non-India, which is correct.
- **First check whether there's an explicit link to Toni** (e.g. `manager_id` / `vendor_manager_id` = Toni's profile, or whatever flag drives their auto-approval). An explicit link is safer than the location + country rule. Check how auto-approval is implemented and key the scope on the same thing, so "whose timesheets are auto-approved for Toni" and "who gets escalated to Toni" can never drift apart.
- Exclusions: ended (`end_date` < week start), not started yet (`start_date` > week end), `reminders_enabled = false`, weeks before `REMINDER_CUTOFF` (2026-04-27), and weeks that are all holidays.
- **Before shipping, list the selected people for Dan to confirm.** A wrong scope means escalating someone else's contractor to Toni.

## Shape
- **Weekly digest**, e.g. Monday 9am PT: one email listing contractor, missing week(s) (W/E Sunday dates), days overdue, project.
- **Once per missing week per contractor.** Keep a small log (e.g. an `escalation_log` table or reuse the reminder logging) so a week is never escalated twice. A contractor who is still missing another week later shows that as a new line.
- Plain English, following [[ui-copy-voice]].

## Where
- New section in `supabase/functions/send-reminder/index.ts` (already hourly via pg_cron job `send-reminders`; already computes missing weeks with `sun` = Mon+6; already sends through Brevo; already honours `reminders_enabled` + `REMINDER_CUTOFF`). No model cost. `?force=true` exists for testing.
- Estimate: ~1–2h, plus the scoping check with Dan.

## Open
- Toni's email address (Dan).
- Is there an explicit link to Toni in the data, or is location + country the only way? (Check first.)
- Should Dan be copied? (Dan said Toni only; confirm if it comes up.)
