-- ============================================================
-- 集計刷新 Phase2: 既存データのコピー移行（単価 + 日報）— 加算モデル版
-- 旧テーブルは温存。新テーブルへコピーするのみ。すべて冪等。
-- 前提: 051〜056 適用済み。
--
-- 課金は「従量(course_unit_rates) + 固定(course_fixed_rates)」の加算。
-- 振り分けの考え方:
--   - 従量分: ヤマト系コースの 宅急便/ネコポス 単価をそのまま移す
--   - 固定分: fixed_revenue/profit を持つコース（キャリア不問）を course_fixed_rates へ
--             payout = max(0, fixed_revenue - fixed_profit)（現行ロジック踏襲）
-- ============================================================

-- ------------------------------------------------------------
-- 2.0 スキーマ補正（053 を legacy_report_id 追加前の版で適用済みの環境向け）
--     冪等。既に新版で適用済みなら何も起きない。
-- ------------------------------------------------------------
ALTER TABLE daily_reports_v2
  ADD COLUMN IF NOT EXISTS legacy_report_id uuid REFERENCES daily_reports(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_v2_legacy
  ON daily_reports_v2 (legacy_report_id) WHERE legacy_report_id IS NOT NULL;

-- 一意制約を「却下されていない日報のみ」に（旧 040 踏襲）。索引を貼り直す。
DROP INDEX IF EXISTS daily_reports_v2_driver_date_course_identity_key;
DROP INDEX IF EXISTS daily_reports_v2_driver_date_course_null_identity_key;
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_v2_driver_date_course_identity_key
  ON daily_reports_v2 (driver_id, report_date, course_id, identity_id)
  WHERE identity_id IS NOT NULL AND rejected_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_v2_driver_date_course_null_identity_key
  ON daily_reports_v2 (driver_id, report_date, course_id)
  WHERE identity_id IS NULL AND rejected_at IS NULL;

-- ------------------------------------------------------------
-- 2.1 従量分: course_rates → course_unit_rates（ヤマト系の 宅急便/ネコポス）
-- ------------------------------------------------------------
INSERT INTO course_unit_rates (course_id, unit_id, revenue_per_unit, profit_per_unit, payout_per_unit)
SELECT cr.course_id, u.id, cr.takuhaibin_revenue, cr.takuhaibin_profit, cr.takuhaibin_driver_payout
FROM course_rates cr
JOIN courses c ON c.id = cr.course_id
JOIN units u ON u.code = 'TAKUHAIBIN'
WHERE c.carrier = 'YAMATO'
ON CONFLICT (course_id, unit_id) DO NOTHING;

INSERT INTO course_unit_rates (course_id, unit_id, revenue_per_unit, profit_per_unit, payout_per_unit)
SELECT cr.course_id, u.id, cr.nekopos_revenue, cr.nekopos_profit, cr.nekopos_driver_payout
FROM course_rates cr
JOIN courses c ON c.id = cr.course_id
JOIN units u ON u.code = 'NEKOPOS'
WHERE c.carrier = 'YAMATO'
ON CONFLICT (course_id, unit_id) DO NOTHING;

-- ------------------------------------------------------------
-- 2.2 固定分: course_rates → course_fixed_rates（キャリア不問）
--   fixed_revenue または fixed_profit を持つコースを対象。
-- ------------------------------------------------------------
INSERT INTO course_fixed_rates (course_id, fixed_revenue, fixed_profit, fixed_payout)
SELECT cr.course_id,
       COALESCE(cr.fixed_revenue, 0),
       COALESCE(cr.fixed_profit, 0),
       GREATEST(0, COALESCE(cr.fixed_revenue, 0) - COALESCE(cr.fixed_profit, 0))
FROM course_rates cr
WHERE COALESCE(cr.fixed_revenue, 0) > 0
   OR COALESCE(cr.fixed_profit, 0) > 0
ON CONFLICT (course_id) DO NOTHING;

-- ------------------------------------------------------------
-- 2.3 daily_reports → daily_reports_v2（ヘッダ）
--   course_id は同日同ドライバーの shift（同キャリア）から逆引き補完。
-- ------------------------------------------------------------
INSERT INTO daily_reports_v2 (
  legacy_report_id, driver_id, report_date, course_id, carrier_id,
  identity_id, vehicle_id, meter_value, submitted_at,
  approved_at, approved_by, rejected_at, rejected_by
)
SELECT
  dr.id,
  dr.driver_id,
  dr.report_date,
  (SELECT s.course_id
     FROM shifts s
     JOIN courses sc ON sc.id = s.course_id
    WHERE s.shift_date = dr.report_date
      AND s.driver_id = dr.driver_id
      AND sc.carrier = dr.carrier
    ORDER BY s.created_at
    LIMIT 1),
  (SELECT id FROM carriers WHERE code = dr.carrier),
  dr.driver_identity_id,
  dr.vehicle_id,
  dr.meter_value,
  dr.submitted_at,
  dr.approved_at, dr.approved_by, dr.rejected_at, dr.rejected_by
FROM daily_reports dr
WHERE dr.carrier IN ('YAMATO', 'AMAZON')
-- 部分索引 idx_daily_reports_v2_legacy（WHERE legacy_report_id IS NOT NULL）に一致させる
ON CONFLICT (legacy_report_id) WHERE legacy_report_id IS NOT NULL DO NOTHING;

-- ------------------------------------------------------------
-- 2.4 daily_reports → report_entries（報告値の縦持ち）
--   報告フィールドは carrier に応じた form（ヤマト=宅急便/ネコポス, Amazon=Amazon配送）。
--   固定(日当)は報告項目ではなく course_fixed_rates 側で加算するため、ここには現れない。
-- ------------------------------------------------------------

-- ヤマト: 宅急便
INSERT INTO report_entries (report_id, unit_id, field_key, value_num)
SELECT v.id, u.id, f.field_key, f.val
FROM daily_reports_v2 v
JOIN daily_reports dr ON dr.id = v.legacy_report_id AND dr.carrier = 'YAMATO'
JOIN units u ON u.code = 'TAKUHAIBIN'
CROSS JOIN LATERAL (VALUES
  ('completed', dr.takuhaibin_completed),
  ('returned',  dr.takuhaibin_returned)
) AS f(field_key, val)
ON CONFLICT (report_id, unit_id, field_key) DO NOTHING;

-- ヤマト: ネコポス
INSERT INTO report_entries (report_id, unit_id, field_key, value_num)
SELECT v.id, u.id, f.field_key, f.val
FROM daily_reports_v2 v
JOIN daily_reports dr ON dr.id = v.legacy_report_id AND dr.carrier = 'YAMATO'
JOIN units u ON u.code = 'NEKOPOS'
CROSS JOIN LATERAL (VALUES
  ('completed', dr.nekopos_completed),
  ('returned',  dr.nekopos_returned)
) AS f(field_key, val)
ON CONFLICT (report_id, unit_id, field_key) DO NOTHING;

-- Amazon: Amazon配送（午前/午後/4便の6フィールド）
INSERT INTO report_entries (report_id, unit_id, field_key, value_num)
SELECT v.id, u.id, f.field_key, f.val
FROM daily_reports_v2 v
JOIN daily_reports dr ON dr.id = v.legacy_report_id AND dr.carrier = 'AMAZON'
JOIN units u ON u.code = 'AMAZON_DELIVERY'
CROSS JOIN LATERAL (VALUES
  ('am_mochidashi',   dr.amazon_am_mochidashi),
  ('am_completed',    dr.amazon_am_completed),
  ('pm_mochidashi',   dr.amazon_pm_mochidashi),
  ('pm_completed',    dr.amazon_pm_completed),
  ('four_mochidashi', dr.amazon_4_mochidashi),
  ('four_completed',  dr.amazon_4_completed)
) AS f(field_key, val)
ON CONFLICT (report_id, unit_id, field_key) DO NOTHING;
