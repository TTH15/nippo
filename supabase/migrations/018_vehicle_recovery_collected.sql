-- 車両保険料の回収済みマーク（月ごと・マークした日付を記録・日本時間の日付のみ）
CREATE TABLE IF NOT EXISTS vehicle_recovery_collected (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  month       int         NOT NULL CHECK (month >= 1 AND month <= 24),
  collected_at date       NOT NULL,  -- YYYY-MM-DD（APIから日本時間で設定）
  UNIQUE (vehicle_id, month)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_recovery_collected_vehicle ON vehicle_recovery_collected (vehicle_id);
