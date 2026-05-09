-- シフト行に使用車両を紐付け（管理画面の配車・ナンバー表示用）
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shifts_vehicle_id ON shifts (vehicle_id);

COMMENT ON COLUMN shifts.vehicle_id IS 'そのシフトで使用する車両（任意）';
