-- Normalize invoice numbers before adding unique constraint
update public.invoice_documents
set invoice_no = null
where invoice_no is not null
  and btrim(invoice_no) = '';

update public.invoice_documents
set invoice_no = btrim(invoice_no)
where invoice_no is not null
  and invoice_no <> btrim(invoice_no);

-- Resolve existing duplicates deterministically (keep oldest as-is)
with ranked as (
  select
    id,
    invoice_no,
    row_number() over (
      partition by company_code, invoice_no
      order by created_at asc, id asc
    ) as rn
  from public.invoice_documents
  where invoice_no is not null
)
update public.invoice_documents d
set invoice_no = ranked.invoice_no || '-DUP' || lpad((ranked.rn - 1)::text, 2, '0')
from ranked
where d.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists idx_invoice_documents_company_invoice_no_unique
  on public.invoice_documents (company_code, invoice_no)
  where invoice_no is not null;

