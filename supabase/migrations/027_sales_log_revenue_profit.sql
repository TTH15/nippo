-- 売上ログに「売上」「利益」を分離して保存する
-- 既存の amount は互換のため残し、profit に同期（移行時は profit=amount, revenue=max(amount,0)）

ALTER TABLE sales_log_entries
  ADD COLUMN IF NOT EXISTS revenue int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit int NOT NULL DEFAULT 0;

-- 既存データ移行: amount から revenue/profit を埋める
UPDATE sales_log_entries
SET
  revenue = CASE WHEN amount > 0 THEN amount ELSE 0 END,
  profit = amount
WHERE
  (revenue = 0 AND profit = 0) OR revenue IS NULL OR profit IS NULL;

COMMENT ON COLUMN sales_log_entries.revenue IS '売上（円）。0以上。';
COMMENT ON COLUMN sales_log_entries.profit IS '利益（円）。マイナス可。';

