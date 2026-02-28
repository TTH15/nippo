-- 車検・定期点検の次回予定日を vehicles に追加
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS next_shaken_date date,
  ADD COLUMN IF NOT EXISTS next_periodic_inspection_date date;
