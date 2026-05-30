-- ============================================================
-- 集計刷新 Phase2: 台帳コピー移行
--   sales_log_entries（会社側 売上/利益）+ driver_ad_hoc_expenses（ドライバー側 支払調整）
--   → ledger_entries（revenue/profit/payout の3 delta に統一）
-- 旧テーブルは温存。冪等。前提: 051〜057 適用済み。
--
-- 方針:
--   - sales_log_entries → revenue_delta=revenue, profit_delta=profit, payout_delta=0
--   - driver_ad_hoc_expenses → payout_delta = -amount（正=控除→支払減, 負=手当→支払増）
--   - 単発報酬のリンク済みペアは2行のまま（別ストリームなので二重計上にならない）
-- ============================================================

-- ------------------------------------------------------------
-- 0. スキーマ補正（054 を legacy 列追加前の版で適用済みの環境向け）。冪等。
-- ------------------------------------------------------------
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS legacy_sales_log_id uuid REFERENCES sales_log_entries(id) ON DELETE SET NULL;
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS legacy_ad_hoc_expense_id uuid REFERENCES driver_ad_hoc_expenses(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_legacy
  ON ledger_entries (legacy_sales_log_id) WHERE legacy_sales_log_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_legacy_adhoc
  ON ledger_entries (legacy_ad_hoc_expense_id) WHERE legacy_ad_hoc_expense_id IS NOT NULL;

-- ------------------------------------------------------------
-- 1. sales_log_entries → ledger_entries（会社側）
-- ------------------------------------------------------------
INSERT INTO ledger_entries (
  entry_date, type_id, content,
  revenue_delta, profit_delta, payout_delta,
  target_driver_id, counterparty_invoice_address_id,
  legacy_sales_log_id, created_at
)
SELECT
  sle.log_date,
  sle.type_id,
  COALESCE(sle.content, ''),
  COALESCE(sle.revenue, 0),
  COALESCE(sle.profit, 0),
  0,
  sle.target_driver_id,
  sle.counterparty_invoice_address_id,
  sle.id,
  sle.created_at
FROM sales_log_entries sle
ON CONFLICT (legacy_sales_log_id) WHERE legacy_sales_log_id IS NOT NULL DO NOTHING;

-- ------------------------------------------------------------
-- 2. driver_ad_hoc_expenses → ledger_entries（ドライバー側 支払調整）
--    entry_date は月初（month='YYYY-MM' に日付が無いため）。
--    payout_delta = -amount（正の控除→支払マイナス、負の手当→支払プラス）。
-- ------------------------------------------------------------
INSERT INTO ledger_entries (
  entry_date, type_id, content,
  revenue_delta, profit_delta, payout_delta,
  target_driver_id,
  legacy_ad_hoc_expense_id, created_at
)
SELECT
  (ahe.month || '-01')::date,
  NULL,
  COALESCE(ahe.name, ''),
  0,
  0,
  -COALESCE(ahe.amount, 0),
  ahe.driver_id,
  ahe.id,
  ahe.created_at
FROM driver_ad_hoc_expenses ahe
ON CONFLICT (legacy_ad_hoc_expense_id) WHERE legacy_ad_hoc_expense_id IS NOT NULL DO NOTHING;
