# Reply-YES Pipeline & LLM Assistants

> Last brought current 2026-08-11.
> The original doc (June 2026) described a Groq LLM as the primary YES/MODIFY/NO classifier. **That classifier was ripped out on 2026-07-12** (commits `1344d77`, `ef274a3`) — see the "Why the LLM was replaced" section at the bottom. The pipeline is now deterministic regex + reply-header trimming. Groq is still used for narrower, non-critical jobs.

---

## Overview

When a contractor replies to a Friday reminder email, the poller decides whether the reply is a "yes, submit last week's hours again" or something that needs a human. The classifier is deterministic (regex whitelist) — if the reply doesn't cleanly match, the poller forwards to helpdesk and never guesses.

```
Reply arrives → strip HTML/quote headers → normalize whitespace →
  ≤60 chars AND matches YES whitelist  → auto-submit last week's hours
  otherwise                             → forward to helpdesk
```

No LLM is in the auto-submit critical path. If the regex says YES, the submission fires. If not, a human handles it.

---

## The pipeline (poller.js)

### Step 1 — Friday reminder personalisation (send-reminder)

Same as before. When generating Friday 5pm reminders, `send-reminder` checks each contractor's recent submission history and appends a "Reply YES" CTA only for consistent submitters:

```
fetch last 5 approved timesheets (order by week_start desc)
if len >= 3 AND NOT portal-only AND consistent (max_hours - min_hours <= 4h):
  isConsistent = true
```

Portal-only contractors (all recent timesheets `source='direct'`) are suppressed from the reply CTA — they should use the portal.

Subject line format: `Timesheet Reminder — Week ending {Sun date, e.g. "Aug 9, 2026"}`. The Sunday date embedded here is how the poller parses the target week when a YES reply arrives (`parseWeekFromSubject`).

### Step 2 — Reply detection in the poller outer loop

The outer `main()` loop routes every UNSEEN IMAP email:

```
1. DMARC report? → delete, skip
2. hasTimesheetContent? (XLSX/PDF/CSV/DOCX attachment) → processEmail()
3. no attachment:
   a. isReply + weekStart parseable + not internal forwarder + allowlisted?
      → classifyReply() flow
   b. else → forward to helpdesk
```

The route-3a-before-3b ordering is load-bearing. Any new `no attachment` branch inserted before 3a will silently steal replies. (This bug happened once, `4ff6bb1` — commit fixed it and the tests pin the order.)

### Step 3 — Reply classification (`classifyReply`, poller.js:3104)

**Deterministic. No network calls. Runs in microseconds.**

Preprocessing (three cuts):

1. **HTML-flattened reply header cut** — HTML mail clients (Apple Mail, Gmail) flatten `<blockquote>` quoting to plain text without `>`-prefix, so a bare "Yes" reply becomes `"Yes\n\nOn Fri, 10 Jul 2026 at 19:00, ... wrote:\n..."`. Split at `On <date> at <time>, <name> wrote:` (regex) and take the first chunk.
2. **`>`-prefix strip** — remove classic plain-text quoted lines.
3. **Signature cut** — split at `-- `, `Sent from`, `Best`, `Regards`, `Thanks`, `Cheers`, `Kind regards`, `Sincerely` so mobile footers don't inflate length past the bare-YES cap.

Then normalize whitespace and apply two guardrails:

- Empty after cuts → `intent: 'NO'`
- Length > 60 chars → `intent: 'OTHER'` (real replies are almost always ≤10 chars; anything longer likely has hours, day names, or prose that regex shouldn't try to interpret)

Finally match against the YES whitelist (`BARE_YES_RE`):

```regex
(?:yes|yeah|yep|yup|yess+|ok|okay|okey|kk|confirm(?:ed)?|approv(?:e|ed)|please\s+submit|submit\s+it|go\s+ahead|proceed|same\s+as\s+last\s+week|da|да|sí|si|sim|oui|ja|aprovado|подтверждаю)
```

Whole string must be one or more YES tokens (comma/`and`/whitespace separated) with optional trailing punctuation. Chains like `"yes, please submit"` or `"ok confirmed"` pass; anything with hours (`"40 hours"`), day names (`"took Monday off"`), or extra prose fails and routes to helpdesk.

**Intent outcomes:**

| Intent | Action |
|---|---|
| `YES` | `fetchLastApprovedEntries` → `setReplyPendingFlag` → `autoSubmitFromReply` |
| `OTHER` | forward to helpdesk with the reply body |
| `NO` (empty body only) | drop silently |

Note there's no `MODIFY` intent anymore. The old LLM path had it but it was never wired into a UI, and regex can't extract "40 hours" reliably. Everything non-YES routes to helpdesk.

### Step 4 — Fetch last approved entries (`fetchLastApprovedEntries`)

Uses `CONFIG.supabaseServiceKey` (not anon — RLS returns `[]` silently for anon reads, see [[feedback_service_role_key]]).

```
GET /rest/v1/profiles?email=eq.{email}&select=id&limit=1
GET /rest/v1/timesheets?user_id=eq.{userId}&status=eq.approved&select=week_start,entries&order=week_start.desc&limit=1
```

Returns `{ userId, weekStart, entries }` or null.

### Step 5 — Set reply-pending flag (`setReplyPendingFlag`)

Writes `system_settings.reply_yes_pending_{userId}` = `{weekStart, created_at, email}` (upsert). `send-reminder` reads all `reply_yes_pending_*` keys at startup; matching users have Monday/Tuesday reminders suppressed for 72h.

Belt-and-suspenders. The approved timesheet in DB is natural suppression on its own — this flag adds a safety net in case ingest fails between accept and insert.

### Step 6 — Auto-submit (`autoSubmitFromReply`)

Copies last week's entries verbatim, zeroes weekends, POSTs to `ingest-timesheet` with:

```json
{
  "source": "direct",
  "forwardedBy": null,
  "messageId": "reply-yes-{originalMsgId}",
  "weekStart": "<parsed from reply subject>",
  "entries": "<last week's, weekends zeroed>"
}
```

The `reply-yes-` prefix is how `send-timesheet-report` classifies the submission as `auto_yes` in the timeliness table, and how [monitor-health](edge-functions.md#monitor-health) SLOs detect zero-hour auto-YES anomalies (Marta 902 / Nikolina 1047 class disasters — see the sanity gate in the next section).

### Step 7 — Auto-YES sanity gate (poller.js:3543)

Before firing the ingest POST, sum the shifted entries. If total = 0, refuse:

```
🚫 Auto-YES sanity gate: refusing 0h submission for {email} (source {srcWeek} → target {tgtWeek})
```

The refusal writes `parse_status='auto_yes_zero_blocked'` to `email_import_log` and returns without ingesting. Rationale: auto-YES exists to replicate a proven pattern; 0h means either the source timesheet was corrupted or the entry-shift logic emitted nothing. Under-invoicing a client is worse than missing a timesheet — [[project_client_invoicing_phase1_test]] documents the Marta/Nikolina near-miss that inspired this gate.

---

## Groq's remaining roles

The LLM was ripped out of YES classification, but Groq still handles narrower judgement calls where a wrong answer just means a log line, not a client under-invoice.

### `groqResolveContractor` (poller.js:390)

**Job:** identify the actual contractor when the sender is an internal forwarder (e.g. `contracts@synergietechsolutions.com`) and the regex-based subject/forwarder-note extraction fails to pin one profile.

**Model:** `llama-3.3-70b-versatile` (Groq free tier)

**Fallback if Groq unavailable:** return null → the email routes to helpdesk. No auto-guessing.

### `checkCorrectionSanity` — GROQ_PRE + GROQ_OCC (poller.js:2665, 2691)

**Job:** decide which week a contractor intended when the filename date range disagrees with dates embedded in the file (stale template).

**Two triggers:**
- `GROQ_PRE`: `filenameWeek ≠ contentWeek` and no correction hint in subject/body. Ask Groq which week wins.
- `GROQ_OCC`: content week already occupied in DB, no filename hint. Ask Groq if this is a re-submission or a new week.

**Output:** `{ assessment, suggested_week, reason }` — added to `weekCandidates`, edge fn's `resolveWeek()` picks the best match.

**Fallback if Groq unavailable:** fall through to `resolveWeek()`'s deterministic logic. No worse than pre-Groq.

### Groq vision — invoice verification + gap-filler (poller.js:2131, 2181)

**Job A (verification):** After the primary invoice parse (regex or Claude) succeeds, independently run Groq vision on the PDF and compare field-by-field. Writes to `email_invoice_log.groq_vision_verification` as jsonb. **Zero production impact** — it's a shadow verification for future migration to Groq-primary.

**Job B (gap-filler):** After any successful parse that returned with missing period/hours/rate/total, try Groq vision to fill the gaps. Zero-cost so always worth trying.

**Current issue** ([[project_groq_vision_layer]]): broken since 2026-08-04, 42/42 nulls today. Qwen3.6-27b emits `<think>` tokens that burn the 400-token budget. No SLO on the null-return rate; silent shadow failure.

### Claude (Anthropic) — invoice extraction primary

Not Groq, but worth listing: `extractInvoice()` uses Anthropic's Claude for OCR-quality timesheet PDF parsing when regex bucketing gives up. Cost tracking via [[project_invoice_claude_cost_review]] — a cron job on the 8th of each month reviews bucketing effectiveness.

Claude vision is also called on **timesheet PDFs** (not just invoices) at `poller.js:2459` when regex extraction fails — this is the same path that flagged Zejd's zero-hour PDF and inspired the 2026-08-11 `success_zero_hours` accept-and-confirm loop ([[project_invoice_ingestion]] history).

---

## Test parameters

| Param | Effect |
|---|---|
| `?dry_run=true` on `send-reminder` | Returns JSON of what would be sent; no emails fired |
| `?test_to=email` on `send-reminder` | Redirects all emails to one address |
| `?test_user=email` on `send-reminder` | Processes only that one user |
| `GROQ_API_KEY` absent in env | `groqResolveContractor` and week-sanity checks return null → fall through to deterministic logic. YES classifier is unaffected (regex is local). |
| `ANTHROPIC_API_KEY` absent in env | Claude PDF fallback skipped → `parse_status='parser_no_extract'` |

Recommended test accounts: Bron (`btamulis@hotmail.com`), Dan Hotmail (`d_banga@hotmail.com`).

---

## Why the LLM classifier was replaced (historical)

The Phase A YES/MODIFY/NO classifier used `llama-3.3-70b-versatile` on Groq. It was ripped out on 2026-07-12 (commits `1344d77`, `ef274a3`) after a series of production incidents:

- **Model deprecations** — `llama-3.1-70b-versatile` retired; had to migrate mid-week
- **JSON-mode quirks** — inconsistent whether the model emitted trailing whitespace, code fences, or extra text alongside the JSON. Every parse variant had to be regex-rescued
- **`<think>` token churn** — Groq's Qwen line started emitting reasoning tokens that consumed the response budget before any JSON came out
- **Silent shadow failures** — when the LLM failed, it returned `NO` (fail-safe) — but the contractor's real intent was lost, and they got no acknowledgement

The domain problem is genuinely trivial: *"did they say yes?"* — English + a handful of other languages, ≤10 char replies in 90%+ of real traffic. Regex handles this with 100% precision. The trade is: MODIFY replies (`"yes but only 32 hours"`) now route to helpdesk instead of being partially parsed — which is a correctness win, not a regression, since the LLM's MODIFY output was never wired to a UI anyway (see [[project_ai_agent_roadmap]] for the ripout audit).

**When to reconsider LLM classification:**
- Phase B natural-language submission (`"40 hours this week"` with no attachment). Regex can't extract quantities reliably; that's LLM-shaped.
- MODIFY UI ever gets built and demand grows.
- Groq stabilizes JSON mode + moves off `<think>`-token models.

Until then, deterministic wins.

---

## DMARC inbox sweep (poller.js)

Runs every poll. IMAP `FROM 'dmarc'` regardless of `\Seen` flag → delete. First run in production cleaned 31 pieces of noise ([[project_dmarc_sweep]]). Not AI-related but shares the poller outer loop.

---

## Backlog

- **Groq vision null-return SLO** — currently silent-fails (see [[project_groq_vision_layer]]). Add a monitor-health check.
- **MODIFY UI decision** — see docs/open-questions.md #8. If built, that opens the door to reintroducing LLM classification for the modify branch specifically.
- **Phase B natural-language submission** — deferred until MODIFY UI decision. Would fold in a light LLM path with heavy sanity gates.
