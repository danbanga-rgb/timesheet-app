# Chat improvements after CA transcript review (2026-09-14)

**Source:** review of 3 Contract Admin transcripts — conv `9478cb95` (Tharun Kumar create today), `fc45b85a` (Sep 10 evening), `94a7c742` (Sep 10 morning). Preceded by prior review at `faf02e19` (Sep 5) already folded into `a735364`.

**Framing:** CA is treating chat like an intake form — she pastes the entire onboarding email from the client. Today's Tharun Kumar create ignored ~60% of her structured input. The refactor is to fold ALL the fields she provides into structured writes.

---

## Schema truth (verified 2026-09-14)

| Field CA typically provides | Column | Table | Currently written on user.create? |
|---|---|---|---|
| name, email | `name`, `email` | profiles | ✅ |
| country (ISO or full) | `country` | profiles | ✅ |
| location_type (derived) | `location_type` | profiles | ✅ |
| role (auth role) | `role` | profiles | ✅ (default `timesheetuser`) |
| project | `project_id` | profiles | ✅ |
| start_date | `start_date` | profiles | ✅ |
| **payment_terms** ("NET+15", "end of month + 15") | `payment_terms` | **profiles** | ❌ column exists, not captured |
| **role_title / position** ("QA Engineer") | `role_title` | **client_engagements** | ❌ no row created |
| **bill_rate** ($65/hr) | `bill_rate` | **client_engagements** | ❌ no row created |
| **client** ("APFM") | `client_id` | client_engagements | ❌ no row created (project ≠ client) |
| SOW reference / attachment | `sow_reference` | client_engagements | ❌ no chat file upload |
| pay_rate ($23/hr) | none — only `invoices.rate` per-invoice | — | ❌ no home |

**Notable:** `user.get` ALREADY reads bill_rate + role_title via `client_engagements` join (chat-parse:872–887). The read pattern exists; only the write is missing.

**Pay rate — LOCKED 2026-09-14: `rate_history` table.** Rate is high-value, audit trail matters. Both pay_rate and bill_rate land in the same table (with a discriminator column).

---

## Slices

Each slice is standalone-shippable. Ordered by CA-value ÷ build-cost.

### Slice 1 — Extend `user.create` extraction schema (~4h)

**Add to intent field catalog (`chat-parse` intents.ts):**
- `payment_terms` (string, optional, default null) — free-form until we standardize
- `role_title` (string, optional, default null)
- `bill_rate` (number, optional, default null) — USD/hr
- `pay_rate` (number, optional, default null) — USD/hr
- `client` (string, optional, default null) — falls back to project's client if omitted

**Extraction hints for the LLM:**
- "position", "title" → role_title
- "bill rate", "billed at", "billing $X" → bill_rate
- "pay rate", "paying $X", "rate: $X" (no bill context) → pay_rate
- "NET15", "NET+15", "NET 30", "net30", "end of month + 15" → payment_terms
- "for APFM", "on Genworth", "client: X" → client (validate against projects.client)

**Executor changes (`execUserCreate`) — one atomic transaction:**
1. Insert `profiles` row (existing shape + `payment_terms` if provided).
2. Resolve `client` field → project_id (see Slice 1b below).
3. If ANY of {role_title, bill_rate, client, project} present: insert `client_engagements` row (user_id, client_id, role_title, bill_rate, effective_from=start_date or today, effective_to=null, sow_reference=null).
4. If `bill_rate` provided: insert `rate_history` row (rate_kind='bill', rate, effective_from, client_engagement_id, source='chat:user.create').
5. If `pay_rate` provided: insert `rate_history` row (rate_kind='pay', rate, effective_from, source='chat:user.create').
6. Roll back all four inserts together on any failure.

**Confirmation summary** additions (deterministic template):
```
Position: QA Engineer
Bill rate: $65/hr
Pay rate: $23/hr
Payment terms: NET+15
```
Only shown when field is set. Null fields hidden.

---

### Slice 1b — Client → project resolution with disambiguation (~1h, part of Slice 1)

CA writes "Client: APFM" meaning the project. Resolution logic:
1. Look up projects where `client` ILIKE '%<input>%' OR project name matches.
2. **Exactly one match** → auto-set project_id + inherit `client_id`.
3. **Multiple matches** → confirmation prompt before proceeding:
   > "APFM" matches two projects: **APFM (APFM-061)** and **APFM-Eng2 (APFM-062)**. Which one? Note: different project codes land on separate invoices.
4. **Zero matches** → ask CA to clarify or list available projects.

Add `_project_resolved` metadata to `captured` (mirror `_target_resolved` pattern) so the confirmation card shows the resolved project unambiguously.

**Slice 1a — `rate_history` schema (blocking, ~1h):**

```sql
CREATE TABLE rate_history (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rate_kind text NOT NULL CHECK (rate_kind IN ('pay','bill')),
  rate numeric(10,2) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,  -- null = current
  client_engagement_id int REFERENCES client_engagements(id),  -- optional link for bill rows
  source text NOT NULL,  -- 'chat:user.create', 'chat:user.update_pay_rate', 'admin:profile-edit'
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  notes text
);
CREATE INDEX rate_history_user_kind_idx ON rate_history(user_id, rate_kind, effective_from DESC);
```

**Backfill:** seed existing pay/bill rates as of today.
- One `rate_history` row per user for the current pay rate (from most recent `invoices.rate` per user); source = `'backfill:invoices'`.
- One `rate_history` row per current `client_engagements` where `effective_to IS NULL` for bill rate; source = `'backfill:client_engagements'`.
- Both use `effective_from = created_at` from the source, or a safe default (2026-04-27 launch) when null.

**Read helper** (single source of truth for "current rate"):
```ts
// supabase/functions/_shared/rates.ts
async function currentPayRate(userId: string): Promise<number | null>
async function currentBillRate(userId: string): Promise<number | null>
// Both: SELECT rate FROM rate_history WHERE user_id=$1 AND rate_kind=$2
//   AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
//   ORDER BY effective_from DESC LIMIT 1
```

Also expose via `execUserGet` — the current pay/bill card lines should read from `rate_history` after backfill, not `invoices.rate` / `client_engagements.bill_rate`. That deprecates the read side of client_engagements.bill_rate over time; keep writing it for one release cycle for safety.

---

### Slice 2 — `role_title` filter on `user.list` + `user.count` (~1h)

CA asked "who all do we have as data engineers" — twice. Currently `user.list` filters on role (auth role), project, country, location_type, vendor_manager, active, missing_start_date. Missing:

- `role_title` — case-insensitive partial match against latest `client_engagements.role_title`
- `bill_rate_min`, `bill_rate_max` — numeric bounds (optional; enables "$85 bill rate people")

**Implementation:** extend `execUserList` query with a LEFT JOIN or subquery on `client_engagements` where `effective_to IS NULL` (current engagement). Filter after fetch since CE is 1:many.

**Classifier synonyms:** "data engineers", "developers", "QA", "PMs" — treat as role_title free-text, NOT profiles.role.

---

### Slice 3 — Offboardings sort + non-contractor filter (~30min)

CA asked "who was the last person that finished" → bot listed 8 terminated in alphabetical order, including the shared `contracts@synergietechsolutions.com` mailbox.

**Two fixes (both locked 2026-09-14):**
1. When `user.list` has `active=false` OR temporal signal ("recent", "last", "latest"), sort by `end_date DESC NULLS LAST`. Add `sort='recent'` extraction hint on temporal words.
2. **Default filter: `role = 'timesheetuser'` unless CA explicitly asks about another role.** Excludes admin, contract_admin, vendormanager, accountant, manager from every "contractors" / "offboardings" query. If CA says "list managers", intent classifier flips filter.

---

### Slice 4 — Interrupt policy (~30min)

Currently mid-confirmation, a new intent-shaped message gets "I didn't catch that. Reply YES to proceed…" — CA had to explicitly type "No" and start over.

**Fix:** in `driveCollecting` when phase = `awaiting_confirmation`, if the LLM classifies the new user message as a DIFFERENT intent (not yes/no/edit), prompt:
> You want to cancel the current [update country] and switch to [list users]? Reply YES to switch, NO to keep confirming.

Plan doc `.claude/plans/chat-bot.md` already specifies this — just not implemented.

---

### Slice 5 — Session timeout tuning (~15min)

**LOCKED 2026-09-14:** CA treats the chat as always-there. `/clear` is the only explicit end. Auto-cancel exists only as a safety net.

- `collecting` phase timeout: **24h** (was 60min). Realistically CA may pause mid-intent for hours; the chat should still remember what he was doing.
- `awaiting_confirmation`: **stays at 30min**. Sitting on a confirmation IS risky — captured state may reference stale filters, so auto-expire is protective here.
- `/clear` remains the intended explicit-end mechanism. Document in EmptyState so CA knows.

---

### Slice 6 — Idle-response tightening (~30min)

CA typed "I'll take it up with the relevant department" — bot dumped the capabilities list. Should have gone idle silently.

**Fix:** in `handleIdle`, if the LLM classifies as `unknown` AND the message is a polite dismissal/closing statement ("I'll…", "thanks", "no worries", "later"), respond with a short acknowledgment ("Got it.") not the capabilities list.

Extraction hint category to add to classifier: `chitchat_close`.

---

### Slice 8 — Scoped reply formatting (~2h)

**Problem:** bot returns the full 9-field profile card for `user.get` regardless of what was asked, and `user.list` returns a static column set that ignores the filter. Noisy when CA asked one specific thing.

**Examples from transcripts:**
- "what is senad role/title" → returned full card (9 lines)
- "who has bill rate of data engineers" → returned standard list without bill_rate or role_title columns

**Design — response projection by focus:**

Add a `focus` field to `user.get` and `user.list` classifier extraction. Values:
- `title` — role_title
- `rate` / `pay_rate` / `bill_rate`
- `dates` — start_date, end_date
- `manager` — vendor_manager
- `location` — country, region, location_type
- `project` — project
- `full` — default when open-ended

**Extraction hints:**
- "what is X's title/role/position" → focus=title
- "X's rate", "how much does X make/bill" → focus=rate
- "when did X start/end/begin/finish" → focus=dates
- "who does X report to" → focus=manager
- "tell me about X", "who is X" → focus=full

**Renderers:**

`renderCard(profile, focus)` returns:
- `focus=title` → `Senad Ibrahimpašić — Data Engineer`
- `focus=rate` → `Senad — Pay $45/hr, Bill $85/hr (Data Engineer)`
- `focus=dates` → `Senad — started 2026-05-07 (active)`
- `focus=manager` → `Senad — reports to Aleksandar Aleksic (email)`
- `focus=location` → `Senad — BA (offshore)`
- `focus=full` → current full card

`renderList(rows, filter)` — columns inherit from the FILTER, not the focus:
- filter has `role_title` → columns: name, email, role_title, project
- filter has `bill_rate_*` → columns: name, email, bill_rate, role_title
- filter has `country` → columns: name, email, country, project
- filter has `project` → columns: name, email, project, role_title
- no filter → default (name, email, project, country, start_date) — current template

Always keep name + email as first two columns for consistency.

**Fallback:** if focus classifier misfires or returns unknown, render full card. Never break the surface — noisy > silent.

---

### Slice 7 — `user.update_pay_rate` / `user.update_bill_rate` write intents (~3h)

**Prerequisite:** Slice 1a lands (`rate_history` table + read helpers).

**Two new intents, mirror shape:**
- `user.update_pay_rate` — close current pay row (`effective_to = new effective_from`) + insert new pay row.
- `user.update_bill_rate` — close current bill row + insert new bill row. Also update `client_engagements.bill_rate` for read-back compatibility during transition.

Both require: target user, new rate. Optional: effective_from (defaults today), notes (reason).

Both require admin/contract_admin permission (existing RBAC).

**Confirmation summary shows before/after:**
```
User: Bozhidar Bozhinovski
Bill rate: $85/hr → $95/hr
Effective: 2026-09-14
Reason: (optional, free text)
```

`rate_history` naturally gives us the "before" — no separate query needed.

---

## Deferred / out of scope

- **SOW attachment upload.** Requires chat file-upload UI + storage + linking. Ties to `[[project_contracts_scope_reframe]]` which is shelved. Not now.
- **Bill rate discount rules** (e.g., GNW offshore = bill - $20). Not a chat intent; belongs on client_engagements as a computed field or admin UI.
- **Sivakumar-style country cleanup.** CA declined to fix. Broader data-hygiene sweep is a separate project — see `[[profile-country-auto-detect-trap]]`.

---

## Execution order

1. **Slice 1a** (schema) — blocks Slice 1 + Slice 7
2. **Slice 1** (user.create extraction) — biggest CA-value item
3. **Slice 2** (role_title filter) — CA already tried this twice
4. **Slice 8** (scoped reply formatting) — pairs naturally with Slice 2 since new filter → new column
5. **Slice 3** (offboarding sort/filter) — quick UX polish
6. **Slice 4 + 5 + 6** (interrupt/timeout/idle) — batch as "chat polish" commit
7. **Slice 7** (write pay/bill rate) — requires Slice 1a + product decision on rate history

Total: ~10-11h if run straight through. Realistically split across 2 sessions.

## Test plan

Before landing Slice 1, run this transcript exactly (paste-as-one-message):
> Name: Test User
> Position: QA Engineer
> Client: APFM
> Start Date: 9/20/2026
> Location: India
> Pay rate: $25/hr
> Payment terms: NET+15
> Bill rate: $68/hr
> Email: qa.test.chat@example.com

Bot should confirm ALL fields (name, email, country, role_title, bill_rate, pay_rate, payment_terms, start_date, project auto-resolved from client). After execution:
- `profiles` row has name, email, country=IN, location_type=offshore, project_id=APFM, start_date=2026-09-20, payment_terms='NET+15', expected_pay_rate=25.00
- `client_engagements` row has user_id, client_id=APFM's client, role_title='QA Engineer', bill_rate=68.00, effective_from=2026-09-20, effective_to=null

Cleanup SQL:
```sql
DELETE FROM client_engagements WHERE user_id = (SELECT id FROM profiles WHERE email = 'qa.test.chat@example.com');
DELETE FROM profiles WHERE email = 'qa.test.chat@example.com';
DELETE FROM auth.users WHERE email = 'qa.test.chat@example.com';
```

---

## Open questions — ALL LOCKED 2026-09-14

1. ✅ Pay rate → `rate_history` table (full audit).
2. ✅ Client="APFM" auto-resolves to project; multi-match asks for confirmation with note that different codes land on separate invoices.
3. ✅ Filter out non-`timesheetuser` accounts by default on contractor/offboarding queries.
4. ✅ `collecting` timeout → 24h (chat is always-there); `awaiting_confirmation` stays 30min; `/clear` is the explicit end.
