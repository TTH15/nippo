-- ============================================================
-- courses: 取引先（請求先）設定
-- ============================================================
-- 請求書作成時に「請求先」をコース単位で決定するための紐付け

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS counterparty_invoice_address_id uuid;

