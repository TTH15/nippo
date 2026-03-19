-- 車両: リース代(デフォルト35,000)と画像URLを追加

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS lease_cost int DEFAULT 35000,
  ADD COLUMN IF NOT EXISTS image_url text;

