-- 諸報告の「経費報告」をペイメント連携するための拡張

ALTER TABLE oil_change_reports
  ADD COLUMN IF NOT EXISTS expense_amount integer;

ALTER TABLE oil_change_reports
  DROP CONSTRAINT IF EXISTS oil_change_reports_kind_allowed;

ALTER TABLE oil_change_reports
  ADD CONSTRAINT oil_change_reports_kind_allowed CHECK (
    report_kind IN ('oil_change', 'repair', 'expense', 'other')
  );

ALTER TABLE oil_change_reports
  ADD CONSTRAINT oil_change_reports_expense_fields CHECK (
    report_kind <> 'expense'
    OR (expense_amount IS NOT NULL AND expense_amount > 0)
  );

ALTER TABLE driver_ad_hoc_expenses
  ADD COLUMN IF NOT EXISTS misc_report_id uuid REFERENCES oil_change_reports(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_ad_hoc_expenses_misc_report_id
  ON driver_ad_hoc_expenses (misc_report_id)
  WHERE misc_report_id IS NOT NULL;

COMMENT ON COLUMN driver_ad_hoc_expenses.misc_report_id IS '諸報告の経費報告由来の行。報告削除時は臨時経費も CASCADE で削除。';
