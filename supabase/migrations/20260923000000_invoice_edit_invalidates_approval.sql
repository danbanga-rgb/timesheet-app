-- Safeguard: mutations to an approved invoice's routing/amount/identity
-- fields flip status back to 'submitted' (the pre-approval review state)
-- so it re-enters the approval flow.
-- Mutations on invoices already pushed to QB (qb_bill_txn_id NOT NULL) are
-- blocked entirely — the accountant must void in QB first before editing.
--
-- Rationale: multiple UPDATE call sites in TS.tsx write to `invoices` and
-- adding a client-side wrapper to each is fragile (any missed handler or
-- future direct-UPDATE bypasses the guard). A BEFORE UPDATE trigger closes
-- the entire class of "edit-without-re-approve" races.
--
-- Invalidator columns (per accountant intent 2026-09-23):
--   Amount:   lines, total_amount, rate, total_hours
--   Routing:  payment_method, payment_profile, payment_terms
--   Identity: invoice_number, user_id, period_start, period_end
--
-- Non-invalidators (post-approval bookkeeping / valid status transitions):
--   pay_on_date, paid_date, qb_export_status, qb_export_status_at,
--   qb_bill_txn_id, attachment_path, notes, corrected, edit_history,
--   group_key, matcher_ignore, reconciliation_*, reviewed_at, reviewed_by,
--   status, submitted_at, source, created_at/by, user_name, project_id,
--   currency, is_vendor_invoice, vendor_manager_id.

CREATE OR REPLACE FUNCTION invoices_invalidate_approval_on_edit()
RETURNS TRIGGER AS $$
DECLARE
  invalidator_changed BOOLEAN := FALSE;
BEGIN
  IF NEW.lines IS DISTINCT FROM OLD.lines
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.rate IS DISTINCT FROM OLD.rate
     OR NEW.total_hours IS DISTINCT FROM OLD.total_hours
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_profile IS DISTINCT FROM OLD.payment_profile
     OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
     OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
  THEN
    invalidator_changed := TRUE;
  END IF;

  IF NOT invalidator_changed THEN
    RETURN NEW;
  END IF;

  -- Q3(b): block routing/amount edits on invoices already pushed to QB.
  -- Force the accountant to void in QB Desktop and clear qb_bill_txn_id
  -- before making changes.
  IF OLD.qb_bill_txn_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify invoice % (routing/amount/identity fields) — already pushed to QuickBooks (qb_bill_txn_id=%). Void the Bill in QB Desktop first, then clear qb_bill_txn_id before re-editing.',
      OLD.id, OLD.qb_bill_txn_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Flip 'approved' → 'pending' when the caller isn't explicitly changing
  -- status. Explicit status transitions (approve→paid, approve→rejected)
  -- pass through unaffected because NEW.status != OLD.status.
  IF OLD.status = 'approved' AND NEW.status = OLD.status THEN
    NEW.status := 'submitted';
    NEW.reviewed_at := NULL;
    NEW.reviewed_by := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_invalidate_approval_on_edit ON invoices;
CREATE TRIGGER trg_invoices_invalidate_approval_on_edit
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION invoices_invalidate_approval_on_edit();
