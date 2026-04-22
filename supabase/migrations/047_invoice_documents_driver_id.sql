-- invoice_documents に driver_id を追加し、incoming（自社に請求）の場合は driver に正規に紐づける

ALTER TABLE public.invoice_documents
  ADD COLUMN IF NOT EXISTS driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL;

-- 既存データを payload.parties.fromParty = 'drv-<uuid>' から backfill
UPDATE public.invoice_documents
SET driver_id = NULLIF(replace(payload->'parties'->>'fromParty', 'drv-', ''), '')::uuid
WHERE driver_id IS NULL
  AND payload->'parties'->>'toParty' = 'ace_creation'
  AND (payload->'parties'->>'fromParty') LIKE 'drv-%';

-- incoming（自社に請求）かつ fromParty が drv- の場合は driver_id を必須とする
ALTER TABLE public.invoice_documents
  ADD CONSTRAINT invoice_documents_incoming_driver_id_required
  CHECK (
    NOT (
      (payload->'parties'->>'toParty' = 'ace_creation')
      AND (payload->'parties'->>'fromParty') LIKE 'drv-%'
      AND driver_id IS NULL
    )
  );

-- 承認待ちの検索・制約用インデックス
CREATE INDEX IF NOT EXISTS idx_invoice_documents_driver_status_month
  ON public.invoice_documents (company_code, driver_id, status, month_yyyy_mm, updated_at DESC);

