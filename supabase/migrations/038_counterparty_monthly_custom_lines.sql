-- 取引先×月次の手入力明細（日割りリース代など）。請求書明細のイメージで管理。
CREATE TABLE IF NOT EXISTS counterparty_monthly_custom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code text NOT NULL,
  invoice_address_id uuid NOT NULL REFERENCES invoice_addresses(id) ON DELETE CASCADE,
  month_yyyy_mm text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cp_custom_month CHECK (month_yyyy_mm ~ '^\d{4}-\d{2}$')
);

CREATE INDEX IF NOT EXISTS idx_cp_custom_lines_lookup
  ON counterparty_monthly_custom_lines (company_code, invoice_address_id, month_yyyy_mm);

COMMENT ON TABLE counterparty_monthly_custom_lines IS '取引先画面の月次カスタム行（リース按分等）。金額=quantity*unit_price。';
