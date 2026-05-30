-- ============================================================
-- 集計刷新 Phase1: 手動調整（台帳）
-- 残業代・最低保証上乗せ・立替費用・リース代・控除を統一。
-- 旧 sales_log_entries は温存（Phase2 でコピー移行）。
-- 種別マスタは既存 sales_log_types を流用する。
-- ============================================================

CREATE TABLE IF NOT EXISTS ledger_entries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date    date        NOT NULL,
  type_id       uuid        REFERENCES sales_log_types(id) ON DELETE SET NULL,
  content       text        NOT NULL DEFAULT '',
  -- 影響（それぞれ独立に設定可。マイナス可）
  revenue_delta int         NOT NULL DEFAULT 0,   -- 取引先請求(売上)への影響
  profit_delta  int         NOT NULL DEFAULT 0,   -- 会社利益への影響
  payout_delta  int         NOT NULL DEFAULT 0,   -- ドライバー支払への影響
  -- 帰属・紐付け
  target_driver_id                uuid REFERENCES drivers(id) ON DELETE SET NULL,
  course_id                       uuid REFERENCES courses(id) ON DELETE SET NULL,
  counterparty_invoice_address_id uuid REFERENCES invoice_addresses(id) ON DELETE SET NULL,
  -- 移行元（旧 sales_log_entries.id）。コピー移行の冪等性・追跡に使う。
  legacy_sales_log_id             uuid REFERENCES sales_log_entries(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entries_legacy
  ON ledger_entries (legacy_sales_log_id) WHERE legacy_sales_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_driver ON ledger_entries (target_driver_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_course ON ledger_entries (course_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_counterparty ON ledger_entries (counterparty_invoice_address_id);

-- 既存種別に台帳用の項目を追加（冪等）
INSERT INTO sales_log_types (name, sort_order) VALUES
  ('残業代', 10),
  ('最低保証', 11),
  ('立替費用', 12),
  ('リース代', 13),
  ('控除', 14)
ON CONFLICT (name) DO NOTHING;
