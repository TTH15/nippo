-- daily_reports に却下ステータス用カラムを追加

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES drivers(id) ON DELETE SET NULL;

