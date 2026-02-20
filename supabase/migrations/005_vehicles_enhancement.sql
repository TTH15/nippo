-- 車両管理の拡張: ナンバー、ドライバー、購入費用、保険料

-- ナンバープレート情報
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS number_prefix text; -- 都道府県名（例: 京都）
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS number_hiragana text; -- ひらがな（例: と）
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS number_numeric text; -- 数字部分（例: 00-00）

-- 購入費用と保険料
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_cost int DEFAULT 0; -- 購入費用（円）
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS monthly_insurance int DEFAULT 0; -- 月々保険料（円）

-- 交換間隔のデフォルトを3000kmに変更
ALTER TABLE vehicles ALTER COLUMN oil_change_interval SET DEFAULT 3000;

-- 車両とドライバーの多対多リレーション
CREATE TABLE IF NOT EXISTS vehicle_drivers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id   uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_vehicle ON vehicle_drivers (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_drivers_driver ON vehicle_drivers (driver_id);
