-- ============================================================
-- courses: 元請け（請求元）設定
-- ============================================================
-- 法人アドレス帳（invoice_addresses）から「請求元」を
-- コース単位で紐付けられるようにする

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS principal_invoice_address_id uuid;

