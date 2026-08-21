-- テナントごとの請求書発行者情報と社印。
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS invoice_postal_code text,
  ADD COLUMN IF NOT EXISTS invoice_address text,
  ADD COLUMN IF NOT EXISTS invoice_tel text,
  ADD COLUMN IF NOT EXISTS invoice_registration_no text,
  ADD COLUMN IF NOT EXISTS invoice_bank_name text,
  ADD COLUMN IF NOT EXISTS invoice_bank_no text,
  ADD COLUMN IF NOT EXISTS invoice_bank_holder text,
  ADD COLUMN IF NOT EXISTS invoice_stamp_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('organization-assets', 'organization-assets', false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN organizations.invoice_stamp_path IS
  '非公開 organization-assets バケット内の社印画像パス。画像本体はDBへ入れない';

-- 現行ACEの固定設定をDBへ移す。社印画像は会社設定UIからアップロード後にpathが入る。
UPDATE organizations SET
  invoice_postal_code = COALESCE(invoice_postal_code, '615-0904'),
  invoice_address = COALESCE(invoice_address, '京都市右京区梅津堤上町21 KKハウスⅡ 101'),
  invoice_tel = COALESCE(invoice_tel, '080-9540-4451'),
  invoice_registration_no = COALESCE(invoice_registration_no, 'T6130001080238'),
  invoice_bank_name = COALESCE(invoice_bank_name, '京都信用金庫 梅津支店'),
  invoice_bank_no = COALESCE(invoice_bank_no, '普通 3058832'),
  invoice_bank_holder = COALESCE(invoice_bank_holder, '口座名義：カ)ｴｰｽｸﾘｴｲｼｮﾝ')
WHERE code = 'ACE';
