-- ============================================================
-- コース別単価（売上・利益・ドライバー支払い）
-- ============================================================

CREATE TABLE IF NOT EXISTS course_rates (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id             uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE UNIQUE,
  -- 宅急便（ヤマト系コース用）
  takuhaibin_revenue    int         DEFAULT 160,   -- 売上単価/個
  takuhaibin_profit     int         DEFAULT 10,     -- 利益/個
  takuhaibin_driver_payout int      DEFAULT 150,    -- ドライバー支払い/個
  -- ネコポス（ヤマト系コース用）
  nekopos_revenue       int         DEFAULT 40,
  nekopos_profit        int         DEFAULT 10,
  nekopos_driver_payout int         DEFAULT 30,
  -- 固定売上・利益（Amazon等、1シフトあたり）
  fixed_revenue         int         DEFAULT 0,     -- 0=宅急便・ネコポスで計算
  fixed_profit          int         DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 既存コースにデフォルト単価を設定（シードで上書き可能）
INSERT INTO course_rates (course_id, takuhaibin_revenue, takuhaibin_profit, takuhaibin_driver_payout, nekopos_revenue, nekopos_profit, nekopos_driver_payout, fixed_revenue, fixed_profit)
SELECT id, 160, 10, 150, 40, 10, 30, 0, 0 FROM courses WHERE name IN ('ヤマトA', 'ヤマトB', 'ヤマトC')
ON CONFLICT (course_id) DO UPDATE SET
  takuhaibin_revenue = 160, takuhaibin_profit = 10, takuhaibin_driver_payout = 150,
  nekopos_revenue = 40, nekopos_profit = 10, nekopos_driver_payout = 30,
  fixed_revenue = 0, fixed_profit = 0;

INSERT INTO course_rates (course_id, takuhaibin_revenue, takuhaibin_profit, takuhaibin_driver_payout, nekopos_revenue, nekopos_profit, nekopos_driver_payout, fixed_revenue, fixed_profit)
SELECT id, 0, 0, 0, 0, 0, 0, 10000, 4000 FROM courses WHERE name = 'Amazonミッドナイト'
ON CONFLICT (course_id) DO UPDATE SET fixed_revenue = 10000, fixed_profit = 4000;
