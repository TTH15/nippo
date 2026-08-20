-- 売上契約とドライバー支払の計算方式を独立させる。
-- BOTH は従量＋固定の混在契約。NONE は計上しない。
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS revenue_rate_mode text NOT NULL DEFAULT 'PER_PIECE'
    CHECK (revenue_rate_mode IN ('NONE', 'PER_PIECE', 'FIXED', 'BOTH')),
  ADD COLUMN IF NOT EXISTS payout_rate_mode text NOT NULL DEFAULT 'PER_PIECE'
    CHECK (payout_rate_mode IN ('NONE', 'PER_PIECE', 'FIXED', 'BOTH'));

COMMENT ON COLUMN courses.revenue_rate_mode IS '取引先売上の計算方式: NONE/PER_PIECE/FIXED/BOTH';
COMMENT ON COLUMN courses.payout_rate_mode IS 'ドライバー支払の計算方式: NONE/PER_PIECE/FIXED/BOTH';

-- 既存コースは現在の非0単価から方式を推定し、次回保存で固定単価が消えないようにする。
WITH modes AS (
  SELECT c.id,
    EXISTS (SELECT 1 FROM course_unit_rates u WHERE u.course_id = c.id AND u.revenue_per_unit <> 0) AS rev_piece,
    EXISTS (SELECT 1 FROM course_fixed_rates f WHERE f.course_id = c.id AND f.fixed_revenue <> 0) AS rev_fixed,
    EXISTS (SELECT 1 FROM course_unit_rates u WHERE u.course_id = c.id AND u.payout_per_unit <> 0) AS pay_piece,
    EXISTS (SELECT 1 FROM course_fixed_rates f WHERE f.course_id = c.id AND f.fixed_payout <> 0) AS pay_fixed
  FROM courses c
)
UPDATE courses c SET
  revenue_rate_mode = CASE
    WHEN m.rev_piece AND m.rev_fixed THEN 'BOTH' WHEN m.rev_fixed THEN 'FIXED'
    WHEN m.rev_piece THEN 'PER_PIECE' ELSE 'NONE' END,
  payout_rate_mode = CASE
    WHEN m.pay_piece AND m.pay_fixed THEN 'BOTH' WHEN m.pay_fixed THEN 'FIXED'
    WHEN m.pay_piece THEN 'PER_PIECE' ELSE 'NONE' END
FROM modes m WHERE m.id = c.id;
