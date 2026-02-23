-- ============================================================
-- 日報に車両・メーターを記録、ドライバーの最終選択車両を保存
-- ============================================================

-- daily_reports に車両IDとメーター値を追加
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS meter_value int;

-- ドライバーの最終選択車両（次回報告時のデフォルト）
CREATE TABLE IF NOT EXISTS driver_vehicle_preferences (
  driver_id   uuid        PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id  uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
