-- 売上ログの単発報酬を臨時経費（手当）と1対1で連携する
ALTER TABLE driver_ad_hoc_expenses
  ADD COLUMN IF NOT EXISTS sales_log_entry_id uuid REFERENCES sales_log_entries(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_ad_hoc_expenses_sales_log_entry_id
  ON driver_ad_hoc_expenses (sales_log_entry_id)
  WHERE sales_log_entry_id IS NOT NULL;

COMMENT ON COLUMN driver_ad_hoc_expenses.sales_log_entry_id IS '売上ログ由来の報酬行。ログ削除時は臨時経費も CASCADE で削除。';
