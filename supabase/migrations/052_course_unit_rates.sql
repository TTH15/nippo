-- ============================================================
-- 集計刷新 Phase1: course × unit ごとの単価
-- ============================================================

CREATE TABLE IF NOT EXISTS course_unit_rates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  unit_id          uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  -- 従量（billing_type = PER_PIECE のとき使用）
  revenue_per_unit int         NOT NULL DEFAULT 0,   -- 売上単価/個
  profit_per_unit  int         NOT NULL DEFAULT 0,   -- 利益/個
  payout_per_unit  int         NOT NULL DEFAULT 0,   -- ドライバー支払/個
  -- 固定（billing_type = FIXED のとき使用、1シフトあたり）
  fixed_revenue    int         NOT NULL DEFAULT 0,
  fixed_profit     int         NOT NULL DEFAULT 0,
  fixed_payout     int         NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_course_unit_rates_course ON course_unit_rates (course_id);
CREATE INDEX IF NOT EXISTS idx_course_unit_rates_unit ON course_unit_rates (unit_id);
