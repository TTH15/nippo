-- 車両のメーカー名とブランド名を分離
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS manufacturer text; -- メーカー名（例: スズキ）
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS brand text; -- ブランド名（例: エブリイ）
