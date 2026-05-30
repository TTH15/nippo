-- ============================================================
-- 集計刷新: コース単位の固定(日当)課金コンポーネント
-- 重要: 従量(course_unit_rates)と「排他」ではなく「加算」される。
--   そのシフトの 売上 = 従量分 + 固定分
--   → 1シフトの途中で歩合↔日当が切り替わる混在コース（例: 下京）も
--     従量分(報告個数×単価) + 日当 を自動合算でき、手動補正が不要になる。
-- course_unit_rates(052) の fixed_* 列は本テーブルへ移したため使用しない。
-- ============================================================

CREATE TABLE IF NOT EXISTS course_fixed_rates (
  course_id     uuid        PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  fixed_revenue int         NOT NULL DEFAULT 0,  -- 1シフトあたり 売上（日当）
  fixed_profit  int         NOT NULL DEFAULT 0,  -- 1シフトあたり 利益
  fixed_payout  int         NOT NULL DEFAULT 0,  -- 1シフトあたり ドライバー支払（日当）
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE course_fixed_rates IS '固定(日当)課金コンポーネント。従量(course_unit_rates)と加算される。行が無い/0 のコースは従量のみ。';
