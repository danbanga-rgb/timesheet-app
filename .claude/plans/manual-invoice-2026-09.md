# Manual Invoice — accountant-created invoice for non-standard payees

**Locked 2026-09-14** after Convera Batch manual-row discussion.

## Motivation

Today's "+ Add manual row" button in the Convera Batch modal adds ephemeral rows straight into the CSV export. When a Convera payment comes back, we have nothing to reconcile against — the row lived only in transient state, never in `invoices`. We have three use cases hitting this pattern:

1. **Timesheet-user, no invoicing** — Arpit / Himavath type. Submits timesheets, accountant pays outside the invoice flow. Handled today via [[project_no_invoice_contractors]].
2. **Not in timesheet system, no invoicing** — recurring outsider paid via Convera (no employee/contractor status).
3. **True one-off** — Monolith etc. Paid once via Convera against a specific bill.

**Change:** replace the "manual row" ephemeral concept with a real `invoices` row created by the accountant. Benefits:
- Persistent audit trail from day zero (variance, dispute, reprint of PDF later — all supported)
- Case 1 gets automatic timesheet matching
- Unifies the "Convera payment comes back → create QB bill → pay bill" pipeline — no separate codepath for manual rows
- KPI cards / freshness SLOs can filter manual invoices explicitly

## Schema changes

### `invoices` — add columns
```sql
ALTER TABLE invoices
  ADD COLUMN created_by uuid REFERENCES profiles(id),
  ALTER COLUMN source SET DEFAULT 'direct';
-- source enum extended: 'direct' | 'imported' | 'manual'
-- Existing CHECK constraint (if any) needs updating; verify before migration.
```

- `created_by` — which accountant created the manual invoice. NULL for `direct` and `imported` (contractor-driven).
- `source = 'manual'` — the new enum value. `direct` and `imported` semantics unchanged.

### `profiles.role` — allow `external_payee`
```sql
-- If role is a CHECK constraint or enum: extend to include 'external_payee'.
-- Verify current role storage (text vs enum) before migration.
```

- `external_payee` — Case 2 + Case 3 payees. Filtered out of contractor lists, chat lookups, timesheet reminders, KPI counts. No login capability.

### Backfill / cleanup

- No backfill needed. Existing rows stay `source='direct'`/`'imported'` with `created_by=NULL`.
- **Not migrating existing Convera manual rows** — they were transient and only exist in past CSV exports. Nothing to move.

## UX flow

### Entry point

**"+ Manual Invoice" button** on the Accountant Invoices tab, top-right filter row (next to Convera Batch / Intuit Batch / Export CSV).

Removes: "+ Add manual row" button on Convera Batch preview modal (per Dan). No deprecation notice; muscle memory not yet institutional.

### Modal

Step 1 — **Payee picker** (searchable, sectioned):
- **Typical one-offs** (top) — payees with role=`external_payee`, most recently used
- **Contractors** (below, collapsible) — profiles with role=`timesheetuser` who currently have `invoice_enabled=false` (i.e., Case 1 candidates)
- **All contractors** (further below, collapsible) — anyone else the accountant might legitimately invoice on behalf of
- **+ Add new one-off payee** — opens inline mini-panel:
  - Name (required)
  - IBAN + SWIFT + Bank Name + Country (required for Convera)
  - Payment method (Intuit / Convera)
  - QB vendor name (optional — accountant can leave blank + set later, with warning at save)
  - On save: creates `profiles` row `role='external_payee'` + `payment_profiles` row `is_default=true`

Step 2 — **Period picker** — month/year select. Defaults to current month.

Step 3 — **Payment method + profile snapshot picker**
- Auto-fills from selected payee's default profile
- Show currency (USD / EUR / etc.) — auto from profile, allow override
- If payee has multiple profiles, dropdown to switch (like existing invoice edit)

Step 4 — **Line item auto-populate** (Case 1 only)
- If payee is `timesheetuser` and has approved timesheets covering the selected month:
  - Fetch weeks whose Sunday-end falls within the month (consistent with consolidation monthly rollup)
  - Auto-populate `lines[]` with `{period_start=weekMonday, hours=weekTotal, rate=<default>}`
  - Display as a summary table: `Week ending Aug 3 | 40h`, `Week ending Aug 10 | 42h`, etc.
- Total hours prefilled from sum
- Rate prefilled from [[project_bill_vs_pay_rate]] — most recent `rate_history` row, kind='pay' (this is what we PAY the contractor; bill_rate is what we charge)
- Total = hours × rate; recalcs on any edit
- Accountant can edit hours per week OR override the total — if override, one lump line with rate=<total/hours>

Step 5 — **Line items lump-sum** (Case 2/3, or Case 1 without timesheets)
- Single line: `{period_start=lastDayOfMonth, hours=1, rate=amount}` OR
- Accountant enters `total = X` directly; system derives a degenerate line

Step 6 — **Invoice number**
- Auto-generated: `MAN-{userShort}-{YYYYMM}` (e.g., `MAN-ARPIT-202608`)
  - `userShort` = uppercased first 6 alphanumerics of payee name
  - Uniqueness: check `invoices.invoice_number` — if collision, append `-2`, `-3` etc.
- Accountant can edit before save

Step 7 — **Pay on date (optional)**
- If accountant knows the batch date, enter it now
- Else leave null; set later via existing invoice edit flow

Step 8 — **Save** → creates `invoices` row with:
- `source = 'manual'`
- `status = 'approved'` (accountant is authoritative — skip submitted phase)
- `created_by = accountant.id`
- `payment_profile` JSONB snapshot from the selected profile
- `lines`, `rate`, `total_amount`, `period_start`, `period_end`, `invoice_number` as entered
- `pay_on_date` if provided
- `attachment_path = null` (no PDF upload in v1 — see out-of-scope)

## Pre-save checks

**Blocking:**
- Payee has payment_profile with IBAN (for Convera) OR is Intuit-eligible

**Warnings (accountant can override):**
- **Duplicate detection:** query `invoices WHERE user_id=X AND period_start ∈ selectedMonth`. If any exist, show: "{payee} already has {N} invoice(s) for {monthName}. Continue anyway?"
- **No QB vendor mapping:** if `payment_profile.qb_vendor_name` is NULL, warn: "This payee has no QB vendor mapping — the invoice will be created but won't push to QB until you map it in Payment Profiles."
- **Timesheet variance** (Case 1 only): if hours are edited away from the auto-filled timesheet total, show `Δ +Nh vs approved timesheets` as inline text near the total. Not a block.

## Downstream integration

- **Invoice tab display:** manual invoices show alongside contractor-submitted ones. Add a small `Manual` chip near the row status so the accountant can see at a glance. Filter option: existing Method filter row could add "Manual" but the semantic is a source, not a method — cleaner to make it a "Source" filter (`All | Contractor | Manual`) separate from the payment-method chips.
- **Convera Batch export:** manual invoices with `paymentMethod=Convera` and `status=approved` naturally get included by existing filter. No batch-modal changes needed beyond removing the "+ Add manual row" button.
- **Intuit Batch:** same. Manual invoice with `paymentMethod=Intuit` flows through the Intuit Batch popup unchanged.
- **QB pipeline:** manual invoice with a paid state feeds through the existing G7/G7.6 executor per [[project_g76_plan]] (now shipped). Payee's `payment_profile.qb_vendor_name` drives the QB Vendor. Bill created + paid as with contractor invoices.
- **KPI cards / Total (USD):** manual invoices count toward totals but shouldn't count against "contractor invoice freshness" SLOs. Filter these by `source != 'manual'` where appropriate — audit the KPI section during Slice 1 ripple check.
- **Reminders / digest emails:** already skipped for `invoice_enabled=false` and `external_payee` — no changes needed.

## Slices

### Slice M0 — Schema migration + type updates (~1h)
- `ALTER TABLE invoices ADD COLUMN created_by uuid REFERENCES profiles(id)`
- Extend `source` values / check constraint to include `'manual'`
- Extend `profiles.role` to allow `'external_payee'` (verify current constraint shape first)
- Update TypeScript `Invoice` interface + `Profile` role type
- No backfill; no code path lit up yet

### Slice M1 — "New one-off payee" mini flow (~3h)
- Component: `NewOneOffPayeePanel` (embedded, not standalone modal)
- Fields: name, IBAN, SWIFT, bank name, country, payment method, optional QB vendor
- Creates `profiles` (role=`external_payee`, no auth user — this is a persona, no login needed) + `payment_profiles` (is_default=true)
- Ripple: profiles-with-no-auth-user needs verification — may need to relax an assumption somewhere. If auth user is a hard req, we create a stub in `auth.users` marked non-loginable
- Filter checks: `external_payee` excluded from timesheet reminders, chat lookups, contractor lists, KPI counts

### Slice M2 — Payee picker component (~2h)
- Searchable dropdown with 3 sections (one-offs, invoice-disabled contractors, all contractors) + "+ Add new" foot
- Reusable so both the Manual Invoice modal AND future flows can use it

### Slice M3 — Manual Invoice modal — Case 3 (lump sum) (~4h)
- Simplest path first: pick payee → pick month → enter amount → invoice number auto-gen → save
- Payment method + currency picker + profile snapshot
- Duplicate warning + no-QB-vendor warning
- Save writes `invoices` row `source='manual'`, `status='approved'`, `created_by=accountant.id`
- Invoice appears immediately in Invoices tab with a `Manual` chip

### Slice M4 — Case 1 (timesheet auto-populate) (~4h)
- When payee is `timesheetuser`, fetch approved timesheets for the selected month
- Aggregate weeks (Sunday-end in month) into `lines[]` and preview
- Rate default from `rate_history` (currentPayRate helper)
- Variance display when accountant edits hours
- Edge case: no timesheets for period → fall back to lump-sum path

### Slice M5 — Hint on "+ Add manual row" on Convera Batch modal (~15min)
- LEAVE the existing button + flow in place (Dan's call 2026-09-14 — probable deprecation later, not now)
- Add an inline hint below the button: "Tip: for a persistent record, create a + Manual Invoice on the Invoices tab first."
- Revisit in 2-3 months: if manual-row usage drops to ~0, remove per original M5 spec

### Slice M6 — Source filter + KPI hygiene (~2h)
- New "Source" filter row on Accountant Invoices tab: `All | Contractor | Manual` (contractor = source in ('direct', 'imported'))
- KPI card audit: which cards should exclude manual? Total (USD) — include. Pending Review — exclude (manual is auto-approved so it's never in review anyway, but be explicit). Approved / Paid — include.
- `Manual` chip on invoice rows in the table

### Slice M7 — Post-hoc audit (~1h)
- Confirm QB pipeline handles a manual invoice end-to-end via a small test invoice against Monolith or a real accountant walkthrough
- Verify Convera Batch export CSV renders the manual invoice with the right vendor_id + amount
- Verify Intuit Batch popup includes the manual invoice
- Verify reminders don't fire for the new `external_payee`

**Total: ~17h realistic.** Split across 2 sessions likely.

## Deferred / out of scope

- **PDF attachment upload for manual invoices.** V1 has no attachment. Case 3 accountant may want to upload a screenshot/receipt — deferrable until first ask. Existing invoice-edit UI already handles attachments; can wire in later.
- **Bulk manual invoice creation.** No "create N invoices at once." Accountant creates one at a time. Reasonable given monthly cadence.
- **Void / delete flow.** Existing invoice status includes `rejected` which functionally voids. Good enough. No hard delete.
- **Auto-numbering scheme review.** `MAN-{userShort}-{YYYYMM}` is a placeholder — if accountant hates it, revisit. Non-blocking.
- **`invoice_enabled=true` for Case 1 contractors.** Not touching that flag. Manual invoice creation is orthogonal to whether contractor may submit their own.

## Related

- [[project_no_invoice_contractors]] — the current state we're partially unwinding (accountant will now create invoices for Arpit et al.)
- [[project_bill_vs_pay_rate]] — rate defaults use PAY rate not BILL rate
- [[project_g76_plan]] — QB Convera pipeline (shipped) that will handle manual invoices unchanged
- [[project_convera_push_routing]] — C-1/C-2/C-4 execution; manual invoices route through these
- [[project_qbwrite_invariants]] — all 36 rules apply
- [[project_umbrella_payment_patterns]] — if a manual invoice's payee is umbrella-linked, existing patterns apply
- [[qbxml_refnumber_collision]] — MAN-prefix keeps our number space clean of collisions with contractor invoice numbers
- [[projects-no-client-id]] — if the manual invoice needs client_engagements handling, client_id derives via existing prefix-match rule

## Open questions

_None — Dan locked the design shape 2026-09-14. Any surprise during Slice M0/M1 (schema shape for `role`, whether `external_payee` needs an auth user) surfaces before execution starts._
