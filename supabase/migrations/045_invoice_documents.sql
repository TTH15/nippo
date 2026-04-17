create table if not exists public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  company_code text not null,
  month_yyyy_mm text not null check (month_yyyy_mm ~ '^\d{4}-\d{2}$'),
  section text not null check (section in ('Amazon', 'ヤマト運輸', '郵便局')),
  counterparty_invoice_address_id uuid null references public.invoice_addresses(id) on delete set null,
  client_name text not null default '',
  issue_date date null,
  invoice_no text null,
  amount numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoice_documents_company_month
  on public.invoice_documents (company_code, month_yyyy_mm, created_at desc);

create index if not exists idx_invoice_documents_counterparty
  on public.invoice_documents (counterparty_invoice_address_id, month_yyyy_mm);

create index if not exists idx_invoice_documents_status
  on public.invoice_documents (company_code, status, created_at desc);
