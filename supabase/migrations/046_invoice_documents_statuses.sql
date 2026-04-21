-- 請求書ステータスを4段階運用へ拡張
-- 旧: draft / sent / paid
-- 新: draft / pending_approval / approved / paid
-- 既存データの sent は pending_approval に寄せる

UPDATE public.invoice_documents
SET status = 'pending_approval'
WHERE status = 'sent';

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.invoice_documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.invoice_documents DROP CONSTRAINT IF EXISTS %I',
      c.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.invoice_documents
  ADD CONSTRAINT invoice_documents_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'paid'));

