-- 売上ログ → 取引先の紐付け（単発案件などを取引先明細に反映）
ALTER TABLE sales_log_entries
  ADD COLUMN IF NOT EXISTS counterparty_invoice_address_id uuid REFERENCES invoice_addresses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_log_entries_counterparty
  ON sales_log_entries (counterparty_invoice_address_id)
  WHERE counterparty_invoice_address_id IS NOT NULL;

-- 明細の摘要オーバーライド（システム行: tk:/nk:/fx:、売上ログ: slr:/sll: など）
CREATE TABLE IF NOT EXISTS counterparty_monthly_line_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code text NOT NULL,
  invoice_address_id uuid NOT NULL REFERENCES invoice_addresses(id) ON DELETE CASCADE,
  month_yyyy_mm text NOT NULL,
  line_key text NOT NULL,
  display_label text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cp_line_labels_month CHECK (month_yyyy_mm ~ '^\d{4}-\d{2}$'),
  UNIQUE (company_code, invoice_address_id, month_yyyy_mm, line_key)
);

CREATE INDEX IF NOT EXISTS idx_cp_line_labels_lookup
  ON counterparty_monthly_line_labels (company_code, invoice_address_id, month_yyyy_mm);

-- 同一単価でドッキングした統合行
CREATE TABLE IF NOT EXISTS counterparty_monthly_merged_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code text NOT NULL,
  invoice_address_id uuid NOT NULL REFERENCES invoice_addresses(id) ON DELETE CASCADE,
  month_yyyy_mm text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cp_merged_month CHECK (month_yyyy_mm ~ '^\d{4}-\d{2}$')
);

CREATE INDEX IF NOT EXISTS idx_cp_merged_lookup
  ON counterparty_monthly_merged_lines (company_code, invoice_address_id, month_yyyy_mm);

CREATE TABLE IF NOT EXISTS counterparty_monthly_merged_line_sources (
  merged_line_id uuid NOT NULL REFERENCES counterparty_monthly_merged_lines(id) ON DELETE CASCADE,
  source_line_key text NOT NULL,
  PRIMARY KEY (merged_line_id, source_line_key)
);

-- 手入力明細: プラス行 / 控除行
ALTER TABLE counterparty_monthly_custom_lines
  ADD COLUMN IF NOT EXISTS row_kind text NOT NULL DEFAULT 'main';

ALTER TABLE counterparty_monthly_custom_lines
  DROP CONSTRAINT IF EXISTS counterparty_monthly_custom_lines_row_kind_check;

ALTER TABLE counterparty_monthly_custom_lines
  ADD CONSTRAINT counterparty_monthly_custom_lines_row_kind_check
  CHECK (row_kind IN ('main', 'deduction'));

COMMENT ON COLUMN counterparty_monthly_custom_lines.row_kind IS 'main=請求加算, deduction=請求から控除（売上ログのマイナス利益などと同様）';

COMMENT ON COLUMN sales_log_entries.counterparty_invoice_address_id IS '取引先（請求先）画面・請求ドラフトに反映する場合に設定';
