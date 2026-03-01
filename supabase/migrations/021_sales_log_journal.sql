-- ============================================================
-- 売上ログを会計仕分け形式に変更（日付・種別・内容・金額・帰属先・対象者・車両・備考）
-- ============================================================

-- 旧 sales_log（日付1行形式）を削除
DROP TABLE IF EXISTS sales_log;

-- 種別マスタ（会社を主語にした種別: 売上・外注費・修理費など）
CREATE TABLE IF NOT EXISTS sales_log_types (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sales_log_types (name, sort_order) VALUES
  ('売上', 10),
  ('外注費', 20),
  ('修理費', 30),
  ('車両費', 40),
  ('単発案件', 50),
  ('その他', 99)
ON CONFLICT (name) DO NOTHING;

-- ログ明細（1行 = 1仕分け）
CREATE TABLE IF NOT EXISTS sales_log_entries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date          date        NOT NULL,
  type_id           uuid        NOT NULL REFERENCES sales_log_types(id) ON DELETE RESTRICT,
  content           text        NOT NULL,
  amount            int         NOT NULL,
  attribution       text        NOT NULL DEFAULT 'COMPANY' CHECK (attribution IN ('COMPANY', 'DRIVER')),
  target_driver_id   uuid        REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id        uuid        REFERENCES vehicles(id) ON DELETE SET NULL,
  memo              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_log_entries_log_date ON sales_log_entries (log_date);
CREATE INDEX IF NOT EXISTS idx_sales_log_entries_type ON sales_log_entries (type_id);
CREATE INDEX IF NOT EXISTS idx_sales_log_entries_target_driver ON sales_log_entries (target_driver_id);
CREATE INDEX IF NOT EXISTS idx_sales_log_entries_vehicle ON sales_log_entries (vehicle_id);

COMMENT ON TABLE sales_log_types IS 'ログ種別マスタ（会社を主語: 売上・外注費・修理費など）';
COMMENT ON TABLE sales_log_entries IS '売上ログ明細（会計仕分け形式・1行1レコード）';
COMMENT ON COLUMN sales_log_entries.amount IS '金額（円）。正=収入/プラス、負=支出/マイナス';
COMMENT ON COLUMN sales_log_entries.attribution IS '帰属先: COMPANY=会社の収支, DRIVER=ドライバーへの請求・支払（請求書でドライバーに請求）';
COMMENT ON COLUMN sales_log_entries.target_driver_id IS '対象者（登録ドライバー）。外注費等で指定時はドライバー報酬として請求書に含める';
COMMENT ON COLUMN sales_log_entries.vehicle_id IS '車両（空欄可）';
