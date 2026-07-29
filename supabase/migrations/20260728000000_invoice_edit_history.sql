-- Append-only audit log for accountant edits to invoice period.
-- Each entry: { at, by, field, old, new, reason }.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS edit_history JSONB NOT NULL DEFAULT '[]'::jsonb;
