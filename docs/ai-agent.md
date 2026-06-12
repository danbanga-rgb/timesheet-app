# AI Agent — Phase A Documentation

> Generated 2026-06-12. May need review as the system evolves.

Phase A is LIVE on `main` as of 2026-06-11. See also `docs/poller-architecture.md` for the full poller flow context.

---

## Overview

The AI agent adds a YES-reply auto-submission flow on top of the existing reminder infrastructure:

1. Friday reminder emails now include a "Reply YES" option for contractors with consistent submission history
2. The poller classifies inbound replies using Groq (LLM)
3. YES → auto-submits a copy of last week's timesheet
4. MODIFY → logged for future human handling (not yet built)
5. NO → dropped

This reuses all existing infrastructure. No new services were added; Groq's free tier handles classification.

---

## Phase A: Full Flow

### Step 1 — Friday reminder personalisation (send-reminder)

When generating Friday 5pm reminders, `send-reminder` checks each contractor's recent submission history:

```
fetch last 5 approved timesheets (order by week_start desc)
if len >= 3 AND NOT portal-only AND consistent (max_hours - min_hours <= 4h):
  isConsistent = true
  avg = round(sum / len)
  patternLine = "You typically submit {avg}h per week."
```

Portal-only contractors (`source='direct'` for all recent timesheets) are **suppressed** from the reply CTA. They should use the portal or the future conversational interface, not the email reply path.

The Friday reminder subject is: `Timesheet Reminder — Week ending {Sun date, e.g. "Jun 15, 2026"}`. This subject line is critical — it's how the poller parses the week when a YES reply arrives.

For consistent contractors, option 1 in the reminder email is: "**Reply YES** to this email to submit the same hours as last week". For others (or portal-only), option 1 is the portal link.

### Step 2 — Reply detection in the poller outer loop

The outer loop in `main()` routes every UNSEEN IMAP email. Routing order is critical:

```
1. DMARC report? → delete, skip
2. hasTimesheetContent? (XLSX/PDF/CSV/DOCX/EML attachment) → processEmail()
3. !hasTimesheetContent:
   a. isReply + weekStart parseable + groqApiKey present + not internal forwarder + allowlisted?
      → classifyReply() flow
   b. else → forward to helpdesk
```

**Critical:** The reply classifier (3a) MUST be checked before the helpdesk forward (3b). If any new `!hasTimesheetContent` branch is inserted before 3a, it will silently intercept replies. This was the bug that made the classifier dead code for weeks after initial deployment — a prior block forwarded to helpdesk and `continue`d before the classifier ran.

**Conditions for classifier to run:**
- `isReply`: subject starts with "Re:" (case-insensitive)
- `weekStart`: parseable from subject (`parseWeekFromSubject()` extracts date from "Week ending Jun 15, 2026" or similar)
- `CONFIG.groqApiKey`: Groq API key present in environment
- Not an internal forwarder email (`!isInternal(fromEmail)`)
- Sender is in the allowlist (`isKnownContractor` RPC returns true)

### Step 3 — Groq classification (`classifyReply`)

Model: `llama-3.3-70b-versatile` on Groq's free tier (14,400 req/day, 6,000 tokens/min).

System prompt:
```
You are classifying a contractor's reply to a timesheet reminder email.
Respond with EXACTLY one JSON object on a single line, no other text:
{"intent":"YES","hours":null,"notes":null}
{"intent":"MODIFY","hours":40,"notes":"took Friday off"}
{"intent":"NO","hours":null,"notes":null}

Rules:
- intent=YES: contractor confirms ("yes", "ok", "go ahead", "same as last week", "correct", "please submit", affirmative in any language)
- intent=MODIFY: contractor specifies different hours (extract numeric hours if mentioned)
- intent=NO: contractor declines or the message is clearly not a timesheet reply
- When in doubt between YES and MODIFY, prefer MODIFY
- When in doubt between MODIFY and NO, prefer NO
```

Quoted reply text (lines starting with `>`) is stripped before classification to focus on what the contractor wrote. Body is truncated to 500 characters. Temperature is 0 for determinism.

Classification outcomes:

| Intent | Action |
|--------|--------|
| YES | `fetchLastApprovedEntries` → `setReplyPendingFlag` → `autoSubmitFromReply` |
| MODIFY | push `reply_modify_pending` to `summary.timesheetReports`, stop |
| NO | push `reply_no`, stop |

If Groq is unavailable (no key, API error, exception), defaults to `intent: 'NO'` — fail-safe, never auto-submits.

### Step 4 — Fetch last approved entries (`fetchLastApprovedEntries`)

```javascript
// Must use service role key — anon key is blocked by RLS
const authHeaders = {
  'apikey': CONFIG.supabaseServiceKey,
  'Authorization': `Bearer ${CONFIG.supabaseServiceKey}`
};

// Step 1: lookup profile by email
GET /rest/v1/profiles?email=eq.{email}&select=id&limit=1

// Step 2: fetch most recent approved timesheet
GET /rest/v1/timesheets?user_id=eq.{userId}&status=eq.approved&select=week_start,entries&order=week_start.desc&limit=1
```

Returns `{ userId, weekStart, entries }` or null if not found.

**Critical RLS trap:** The anon key (`SUPABASE_ANON_KEY`) cannot read `profiles` or `timesheets` directly. RLS returns `[]` with no error, making the bug look like "contractor has no history." Always use `CONFIG.supabaseServiceKey` for direct table reads.

This was the bug in commit `a433b8a` — `fetchLastApprovedEntries` was using the anon key and silently returning null for all contractors, causing every YES reply to be logged as "no history found" and no auto-submit ever fired.

### Step 5 — Write reply-pending flag (`setReplyPendingFlag`)

Before auto-submitting, writes to `system_settings`:

```json
key: "reply_yes_pending_{userId}"
value: { "weekStart": "YYYY-MM-DD", "created_at": "ISO", "email": "contractor@email.com" }
```

This is written with `Prefer: resolution=merge-duplicates` (upsert). It runs before the ingest call — if ingest fails, the flag still suppresses Monday reminders (preventing a reminder to a contractor who tried to submit but failed).

`send-reminder` reads all `reply_yes_pending_*` keys at startup and builds a set of user IDs to suppress for 72 hours. If the flag is within 72h, Monday/Tuesday reminders are skipped for that user.

This is a belt-and-suspenders safety measure. Once the YES flow has 2–3 weeks of clean runs, remove:
- `setReplyPendingFlag()` call in poller
- The `reply_yes_pending_*` check in `send-reminder`

The approved timesheet in the DB is sufficient natural suppression.

### Step 6 — Auto-submit (`autoSubmitFromReply`)

```javascript
// Zero out weekend hours, preserve weekday pattern
entries[dateKey] = (dow === 0 || dow === 6)
  ? { ...entry, hours: '0' }
  : { ...entry };

// Post to ingest-timesheet
payload = {
  contractorEmail,
  displayName: contractorName,
  weekStart,           // parsed from reply subject
  entries,             // copied from last approved timesheet, weekends zeroed
  source: 'direct',
  forwardedBy: null,
  messageId: `reply-yes-${messageId}`,  // prefix used for channel classification
  runId,
};
```

The `reply-yes-` prefix on `messageId` is how `send-timesheet-report` classifies this submission as `auto_yes` in the timeliness table.

`source: 'direct'` means correction rules apply: if the contractor already submitted this week via portal, it becomes `correction_pending` (not overwritten). If no submission exists, it creates a new approved timesheet.

### Summary reporting

YES auto-submit pushes to `summary.timesheetReports`:
```javascript
{ action: 'reply_yes_submitted', contractorName, week, attachmentName: '(reply)', notes: 'auto-submitted from YES reply' }
```

MODIFY pushes:
```javascript
{ action: 'reply_modify_pending', contractorName, week, attachmentName: '(reply)', notes: classifier.notes }
```

These appear in the helpdesk summary email and in the `timesheetReports.length > 0` gate for `triggerTimesheetReport`.

---

## Infrastructure

### Groq (current)
- Model: `llama-3.3-70b-versatile`
- Free tier: 14,400 requests/day, 6,000 tokens/min
- API: OpenAI-compatible (`https://api.groq.com/openai/v1/chat/completions`)
- Secret: `GROQ_API_KEY` in GitHub Actions secrets
- Key: stored as `GROQ_API_KEY` GitHub Actions secret — rotate at console.groq.com if compromised

### Oracle VM (pending — for self-hosting)
- Account created, OCI CLI configured, networking set up (VCN/subnet/IGW in tenancy `ocid1.tenancy.oc1..aaaaaaaaol5nhcsevcpcc2lgb6gtvwsaszqcnx3hkvrmyglr2wrplvqupnpq`)
- Instance creation BLOCKED — all 3 US-ASHBURN ADs returning "Out of capacity for VM.Standard.A1.Flex" as of 2026-06-11
- SSH key: `/Users/dbanga/Documents/Synergie/ssh-key-2026-06-11.key`
- ADs: `tZkU:US-ASHBURN-AD-1/2/3`, Image OCID: `ocid1.image.oc1.iad.aaaaaaaas3q57pjdbmj46ykc5djtazakxanfvvadw43iuyguiue6ruvjd6yq`, Subnet OCID: `ocid1.subnet.oc1.iad.aaaaaaaaxpxduq4dm372g4crkv4cyfnj74lxdimnagwpdannutlanlnvfpeq`

When Oracle instance is available:
1. Assign public IP via VNIC
2. SSH: `ssh -i /Users/dbanga/Documents/Synergie/ssh-key-2026-06-11.key ubuntu@<public-ip>`
3. Install Ollama: `curl -fsSL https://ollama.ai/install.sh | sh`
4. Pull model: `ollama pull llama3.2` (or similar)
5. Expose via Cloudflare Tunnel (no port forwarding needed)
6. Switch poller: one-line URL change (Groq and Ollama are both OpenAI-compatible)

### 2FA
Oracle requires 2FA. Dan uses Oracle Authenticator app (TOTP, no network needed after setup). Oracle remembers trusted devices.

---

## Test Parameters

| Param | How to use |
|-------|-----------|
| `?dry_run=true` on `send-reminder` | Returns JSON of what would be sent; no emails fired |
| `?test_to=email` on `send-reminder` | Redirects all emails to one address |
| `?test_user=email` on `send-reminder` | Processes only that one user |
| `GROQ_API_KEY` absent in env | Classifier returns `intent: 'NO'` for all replies — safe no-op |

Recommended test accounts: Bron (`btamulis@hotmail.com`) and Dan Hotmail (`d_banga@hotmail.com`).

---

## Bugs Found on First Run (2026-06-11)

These issues were found and fixed before the first real-world run:

1. **Classifier dead code** (commit `4ff6bb1`): The outer loop had a `!hasTimesheetContent` block that forwarded to helpdesk with `continue` before the reply classifier check. Every YES reply was forwarded to helpdesk and never classified. Fixed by reordering the branches.

2. **`fetchLastApprovedEntries` using anon key** (commit `a433b8a`): RLS blocked profile and timesheet reads; function silently returned null for all contractors. Fixed by switching to `CONFIG.supabaseServiceKey`.

3. **`sendSummaryEmail` crash on reply entries** (commit `503b163`): `timesheetReports` entries from the classifier had different field names than what `sendSummaryEmail` expected for `.padEnd()` formatting. Fixed by standardising on `action`, `contractorName`, `week`, `attachmentName`, `notes`.

4. **`timesheetReports` missing from actionable count** (commit `c16b819`): The `actionable` sum at end of `main()` didn't include `timesheetReports.length`, so a run with only YES replies never sent the summary email or triggered the timesheet report. Fixed.

---

## Backlog (Phase A)

1. **Remove reply_yes_pending flag** — Once 2–3 weeks of clean YES runs: delete `setReplyPendingFlag()` call in poller and the `reply_yes_pending_*` check in `send-reminder`. The approved timesheet in DB is sufficient.

2. **Operational readout** — A daily/weekly summary showing reply counts (YES/MODIFY/NO), auto-submit success rate, suppressed reminders. Admin needs a "just know the system is healthy" signal without digging into logs.

3. **MODIFY flow UI** — When poller logs `reply_modify_pending`, what does the accountant see? Options: email notification, flag in invoices/timesheet UI. Must be decided before Phase B.

4. **Oracle VM** — Once capacity frees up, set up Ollama and switch from Groq.

---

## Phase B: Natural Language Submission (Not Built)

- Contractor emails "40 hours this week" with no attachment
- Poller: no attachment detected → pass body text to LLM → extract hours per day → submit
- New branch in `processEmail()` or outer loop; not a rewrite
- Higher risk than Phase A (free-form input vs yes/no classification)

## Phase C: Conversational Portal (Not Built)

- Chat widget in portal backed by a new Claude API edge function
- System prompt describes schema + user role; agent has read/write Supabase access
- Always confirms before any write operation
- Separate project; higher risk surface

**Agreed starting order:** A → B → C. Phase A must have weeks of clean runs before investing in B.
