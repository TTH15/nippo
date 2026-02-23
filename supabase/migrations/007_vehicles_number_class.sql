-- 車両ナンバーの分類番号を追加（例: 400, 300, 500 など）
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS number_class text;
