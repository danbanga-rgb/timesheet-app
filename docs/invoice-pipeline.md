# Invoice Pipeline

> Generated 2026-06-12. May need review as the system evolves.

Status: LIVE as of 2026-06-01. Ingestion is working. See roadmap section for planned phases.

---

## End-to-End Flow

```
Contractor sends invoice → lpinto@ validates → forwards to timesheets@mysynergie.net
  ↓
Poller (:28/hr) fetches UNSEEN emails
  ↓
Email classified: hasTimesheetContent = false, has PDF/DOCX attachment → invoice path
  ↓
extractInvoice(pdfText | docxText) → { period, amount, rate, hours, paymentDetails }
  ↓
POST /functions/v1/ingest-invoice { forwardedBy: 'lpinto@...', contractorEmail, ... }
  ↓
ingest-invoice:
  - Forwarder gate (forwardedBy required)
  - User lookup (no auto-create)
  - Field validation
  - Reconcile against approved timesheets
  - INSERT into invoices
  - Upload PDF to invoice-attachments bucket
  - Log to email_invoice_log
  ↓
sendInvoiceAccountingEmail() → accounting@synergietechsolutions.com
```

---

## Invoice Detection

The poller classifies each email attachment as `timesheet`, `invoice`, `both`, or `unknown` based on a scoring function that inspects filename patterns and content keywords.

- Filenames like `invoice`, `faktura`, `bill` → invoice
- Filenames like `timesheet`, `timecard`, `WE-`, `hours` → timesheet
- DOCX files: always routed to invoice pipeline (no known DOCX timesheet format)
- PDF files: scored on content keywords

If a PDF scores as `both` (contains both timesheet-like and invoice-like patterns), both paths are attempted.

---

## Invoice Extraction (`extractInvoice`)

Four parse methods, tried in order of increasing cost:

| Method | Description | Cost |
|--------|-------------|------|
| `regex` | Pattern-matched extraction; covers contractor, period, hours, rate, amount, payment details | Free |
| `regex_no_payment` | regex succeeded for core fields but no payment section found | Free |
| `regex+claude_payment` | regex got core fields; Claude called only for payment/bank details | Paid (partial) |
| `claude_full` | Full Claude API call for all fields | Paid |
| `claude_vision` | Claude with image input (for scanned/image PDFs) | Paid (expensive) |
| `regex_partial` | regex got some fields; no Claude fallback triggered | Free |

`parseMethod` is stamped on every result and prepended to `email_invoice_log.parse_notes` as `[parseMethod]`.

**Cost optimization:** The payment-only Claude call is skipped if PDF text contains no payment keywords (`iban`, `swift`, `bic`, `account no/number`, `sort code`, `routing`, `bank name/details/transfer`). This saves ~30–40% of Claude calls for Intuit-style invoices that don't embed bank details.

**Math derivation:** If 2 of 3 financial fields (hours, rate, amount) are known, the third can be derived. This means partial regex coverage still avoids a full Claude call.

---

## Parse Method Tracking and Cost Review

Monthly cost review: query `email_invoice_log` for Claude hit rate.

June 2026 baseline: 33/44 invoices used Claude (75%). Layer 1 dedup (skip Claude on already-processed messages) deployed 2026-06-08. Invest in regex expansion only if Claude calls exceed ~20/month after dedup.

**Parser bucketing direction** (proposed 2026-06-08, not yet implemented): Instead of a universal regex gauntlet, bucket invoices by contractor/template and use a targeted extractor per bucket, storing the last-used template in `profiles`. More accurate, lower false-positive rate, no gauntlet overhead.

---

## `invoiceAlreadyProcessed()` Deduplication (Layer 1)

Before calling Claude, checks `email_invoice_log` for a prior successful parse of the same `message_id`. If found, returns the cached result. This prevents repeated Claude calls for reprocessed emails.

`correctionHint=true` (from correction keywords in the email subject/body: `correction`, `corrected`, `revised`, `fixed`, etc.) bypasses the dedup check and forces a replacement parse. This is wired through both the poller (`correctionHint` in request) and `ingest-invoice` (reads it to bypass the `isDuplicate` DB check).

---

## `ingest-invoice` Edge Function

**Forwarder-only gate:** `forwardedBy` must be set. Direct contractor invoice submissions are rejected with `direct_invoice_not_accepted`. Reason: invoices have financial consequences. Accounting already reviews every invoice manually; forwarding replaces "manually enter this" without removing the human checkpoint.

**No auto-create users:** Identical policy to `ingest-timesheet`. Unknown emails return `unknown_contractor`.

**Status on ingest:** All invoices land as `status='submitted'`. Unlike timesheets, never auto-approved. Accountant must review before approving.

**Reconciliation at insert time:** `ingest-invoice` reconciles against current approved timesheets and stores `reconciliation_status` and `reconciliation_delta`. The UI also runs `reconcileInvoiceLive()` on every render using current timesheet state, so the badge updates if a timesheet is approved after the invoice was ingested.

**Hours derivation:** If `totalHours` is null (amount-only invoice, e.g. Damir Husadzic), queries approved timesheets for `[period_start, period_end]`, sums hours, stores as `total_hours` with note in `parse_notes`. The modal "Total Hours" cell shows the live TS figure with "from TS" label when the invoice has no stated hours.

---

## Special Sender Handling

### Intuit/QuickBooks (Procal Technologies)
Contractor uses QuickBooks payment requests. Emails arrive from `quickbooks@notification.intuit.com` (not contractor).

Resolution: `isIntuitNotification(fromEmail)` → extract first name from first attachment filename (`Sivakumar_Company_WE-...pdf` → `Sivakumar`) → `find_profile_by_first_name` RPC (SECURITY DEFINER, `LIMIT 2` — ambiguity guard). `forwardedBy = null` because Procal (the contractor) initiated the submission.

**Risk:** If two contractors share a first name, the Intuit email is skipped with `intuit_unresolved_contractor`.

### DOCX Invoices (Slaven Konforta, Nikolina Radošević)
Word template invoices. DOCX = always routed to invoice pipeline.

DOCX text extraction: `adm-zip` unzips the DOCX buffer, reads `word/document.xml`, concatenates `<w:t>` elements **without separators** (legitimate spaces are explicit in DOCX text). Do NOT separate `<w:t>` with spaces — DOCX XML splits numbers across runs, and adding spaces produces `1h @ $5 = $5` for `168h @ $35 = $5,880`. The math passes cross-validation and Claude is never called — wrong data enters DB silently.

### Subject-Name Fallback (forwarded with no body email)
When lpinto downloads an external invoice and forwards it, there is no original sender email in the body.

`findProfileBySubjectName(subject)` extracts capitalised non-stopword tokens, calls `find_profiles_by_name_words` RPC with progressively smaller word sets. First set returning exactly 1 profile wins.

**RLS trap:** This must use an RPC (SECURITY DEFINER), never a direct REST call to `profiles` with the anon key. The anon key returns `[]` silently.

---

## Convera Payment Matching

The accountant Invoices tab has a Convera Matching modal that links invoice payment profiles to Convera beneficiary records for reconciliation.

### `convera_beneficiaries` table
163 records from the Convera export. Source of truth for contractor IBANs. The JSON source file `scripts/poller/convera-beneficiaries.json` is gitignored.

### `convera_transactions` table
138 transactions from 11 payment orders (Mar–Jun 2026). One row per line item.

Used by the modal to show "last paid" date: `max(date_of_order)` per `convera_beneficiary_id`.

### Shared IBAN gotchas (critical)
- `LT633250056365211440` (Lithuanian Revolut pool): shared by **24 contractors**
- `IE18REVO99036092001905` (Irish Revolut pool): shared by **9 contractors**
- Cannot use IBAN alone to identify these contractors. Match by name, email, or `convera_beneficiary_id`.
- Native Teams Limited (intermediary): 5 candidates — cannot resolve per contractor
- Bimosoft: use "UK ALT" profile (`GB38TCCL04140417510230`) for Amar Pljevljak + Naretena Arnaut
- Teal Crossroads (`BA395672410000868692`): umbrella for 6 contractors

### Invoice payment matching results (as of 2026-06-10)
29/58 pre-May invoices marked paid via Convera match. 29 unmatched: Intuit-paid, Bimosoft, not-yet-paid, etc. Script: `scripts/poller/mark-invoices-paid.js`.

---

## Invoice Profile Management

### Profile snapshot, not FK
`invoices.payment_profile` is a full JSON snapshot of the PaymentProfile object (camelCase keys). Not a FK. Switching profiles = replacing the snapshot via `UPDATE invoices SET payment_profile = <newProfileObject>`.

### Switching profiles (built 2026-06-10)
- Contractor has 2+ profiles: "Switch" button in the payment details card header
- No profile attached + contractor has profiles: amber "No payment profile attached" card with "Assign Profile" button
- Contractor has only 1 profile: no button (nothing to switch to)

**Why:** Contractors occasionally submit with the wrong profile (e.g., personal account instead of company account). Accountant corrects before approving without asking contractor to resubmit.

### Payment terms (built 2026-06-10)
- NET15 / NET30 / NET45 / NET60 (no free-form)
- Default stored on `profiles.payment_terms`; overridable per invoice on `invoices.payment_terms`
- Cascade: changing terms on an invoice modal also writes to `profiles.payment_terms`
- Pay On calculation: `period_end + N days`, rounded to next 15th or EOM, adjusted for weekends (Saturday → Friday, Sunday → Monday). No holiday awareness.
- 14 contractors seeded from historical payment history (May–Jun 2026)

---

## Known Gaps and Backlog

**No contractor notification:** Contractor never hears that their invoice was received or approved. Phase 2 of the roadmap adds status emails.

**Month filter pills (resolved 2026-06-08):** Initially missing from the accountant Invoices tab. Now live.

**EUR/USD display bug (resolved 2026-06-08):** Parser was reading non-USD amounts. Fixed by improving parser to read actual USD values. There is no EUR→USD conversion logic — if a non-USD invoice appears, it's a parsing failure.

**Payment profile matching not automated:** No auto-match of incoming IBAN to existing profiles. Accounting manually assigns profiles via the Switch/Assign UI. Could be improved for returning contractors who always use the same profile.

---

## Invoice Roadmap (4 phases)

**Phase 1 (current):** Validate ingestion and display end-to-end. Fix any bugs before building on top.

**Phase 2:** Status emails to contractors at each transition: ingested (received and logged), approved to pay, paid. Reuses Brevo infrastructure.

**Phase 3:** Contractors can drag/drop their own invoice PDF into the portal. Runs through the same `extractInvoice()` parser. No email required.

**Phase 4:** Roll out Phase 3 to all `timesheetuser` accounts. Requires UX work and controlled rollout.

Do not start Phase 2+ until Phase 1 is confirmed clean. Each phase gates the next.
