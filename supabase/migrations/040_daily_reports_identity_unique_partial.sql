-- daily_reports の勤務区分×日付の一意制約を
-- 「却下されていない日報」にだけ効くように変更する。
-- これにより、同じ勤務区分・同じ日付でも、
-- 却下済みの日報と未却下（日報編集後など）の日報が共存できる。

-- 既存の UNIQUE 制約を削除
ALTER TABLE daily_reports
  DROP CONSTRAINT IF EXISTS daily_reports_identity_report_date;

-- 却下されていない行だけを対象にした部分インデックスを作成
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_identity_report_date_active
  ON daily_reports (driver_identity_id, report_date)
  WHERE rejected_at IS NULL;

