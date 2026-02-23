-- 車両名(name)を削除。メーカー名+ブランド名で十分なため。
-- 既存データ: manufacturer/brand が空の場合は name を brand にコピー
UPDATE vehicles
SET manufacturer = COALESCE(manufacturer, ''),
    brand = COALESCE(brand, name)
WHERE (manufacturer IS NULL OR brand IS NULL) AND name IS NOT NULL;

ALTER TABLE vehicles DROP COLUMN IF EXISTS name;
