-- ============================================================
-- ドライバー（個人）の請求書用情報
-- 住所・電話・銀行口座をドライバー登録時に入力
-- ============================================================

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_no text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bank_holder text;
