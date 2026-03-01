-- ============================================================
-- 売上ログ（日付ごとのドライバー支払い・車両費・単発案件など）
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date        date        NOT NULL UNIQUE,
  driver_payment  int         NOT NULL DEFAULT 0,
  vehicle_repair  int         NOT NULL DEFAULT 0,
  oil_change      int         NOT NULL DEFAULT 0,
  one_off_amount  int         NOT NULL DEFAULT 0,
  one_off_memo    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_log_log_date ON sales_log (log_date);

COMMENT ON TABLE sales_log IS '日付ごとの売上ログ（ドライバー支払い・車両修理費・オイル交換代・単発案件）';
COMMENT ON COLUMN sales_log.driver_payment IS 'ドライバーへの支払い（円）';
COMMENT ON COLUMN sales_log.vehicle_repair IS '車両修理費（円）';
COMMENT ON COLUMN sales_log.oil_change IS 'オイル交換代（円）';
COMMENT ON COLUMN sales_log.one_off_amount IS '単発案件の金額（円）';
COMMENT ON COLUMN sales_log.one_off_memo IS '単発案件のメモ';
