alter table public.invoice_documents
  add column if not exists is_starred boolean not null default false;

create index if not exists idx_invoice_documents_company_starred
  on public.invoice_documents (company_code, is_starred);

