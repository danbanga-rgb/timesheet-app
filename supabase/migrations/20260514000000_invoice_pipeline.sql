-- Invoice pipeline schema additions
-- 1. Add source + reconciliation columns to invoices
-- 2. Create email_invoice_log table (mirrors email_import_log for invoice emails)

-- ============================================================
-- invoices — new columns
-- ============================================================

alter table public.invoices
  add column if not exists source text not null default 'direct'
    check (source in ('direct', 'imported')),
  add column if not exists reconciliation_status text
    check (reconciliation_status in ('matched', 'mismatch', 'unverifiable')),
  add column if not exists reconciliation_delta float,   -- invoice hours − timesheet hours (signed)
  add column if not exists reconciliation_notes text;

-- Backfill: all existing invoices were submitted directly via the UI
update public.invoices set source = 'direct' where source is null or source = 'direct';

-- ============================================================
-- email_invoice_log — new table
-- ============================================================

create table if not exists public.email_invoice_log (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  message_id       text not null,
  from_email       text not null,
  subject          text,
  attachment_name  text,
  parse_status     text not null
    check (parse_status in ('success', 'partial', 'failed', 'duplicate')),
  parse_notes      text,
  user_id          uuid references public.profiles(id),
  invoice_id       bigint references public.invoices(id),
  period_start     text,   -- YYYY-MM-DD
  period_end       text,   -- YYYY-MM-DD
  raw_extracted    jsonb,
  attempt_count    int not null default 1
);

create index if not exists email_invoice_log_message_id_idx
  on public.email_invoice_log (message_id);

create index if not exists email_invoice_log_user_id_idx
  on public.email_invoice_log (user_id);

-- ============================================================
-- Grants and RLS for email_invoice_log
-- ============================================================

grant select, insert
  on public.email_invoice_log
  to authenticated;

alter table public.email_invoice_log enable row level security;

do $$ begin
  create policy "authenticated users can read invoice log"
    on public.email_invoice_log for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "authenticated users can insert invoice log"
    on public.email_invoice_log for insert to authenticated with check (true);
exception when duplicate_object then null;
end $$;
