-- ============================================================
-- 追加マイグレーション: 会社コード・ドライバーコード対応
-- ============================================================

-- driversテーブルにカラム追加
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS company_code text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS office_code text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_code text UNIQUE;

-- 既存データにデフォルト値を設定（開発用）
UPDATE drivers SET company_code = 'AAA' WHERE company_code IS NULL;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_drivers_company_code ON drivers (company_code);
CREATE INDEX IF NOT EXISTS idx_drivers_driver_code ON drivers (driver_code);

-- 会社マスタ（将来の拡張用）
CREATE TABLE IF NOT EXISTS companies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE, -- 3文字の会社コード
  name        text        NOT NULL,
  admin_pin_hash text,    -- 管理者共有PIN
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 開発用の会社データ
INSERT INTO companies (code, name) 
VALUES ('AAA', '開発会社')
ON CONFLICT (code) DO NOTHING;
