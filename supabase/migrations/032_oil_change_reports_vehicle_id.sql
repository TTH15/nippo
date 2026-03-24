-- ============================================================
-- oil_change_reports: 実施車両を保存
-- ============================================================
ALTER TABLE oil_change_reports
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicles(id);

CREATE INDEX IF NOT EXISTS oil_change_reports_vehicle_id_idx
  ON oil_change_reports(vehicle_id);
