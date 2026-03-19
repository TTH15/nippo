-- 車両: 自賠責の更新月(YYYY-MM)を追加、定期点検は廃止

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS jibaiseki_renewal_month char(7);

-- UI/アプリ側で利用しないため削除（既に無い場合は無視）
ALTER TABLE vehicles
  DROP COLUMN IF EXISTS next_periodic_inspection_date;

