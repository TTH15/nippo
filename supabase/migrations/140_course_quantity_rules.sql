-- 従量単価の数量計算ルール。売上契約とドライバー支払で条件が異なる場合に備えて分離する。
-- 初期対応: actual（実数）/ minimum（1日報あたり最低保証数量）。
ALTER TABLE course_unit_rates
  ADD COLUMN IF NOT EXISTS revenue_quantity_rule jsonb NOT NULL DEFAULT '{"kind":"actual"}'::jsonb,
  ADD COLUMN IF NOT EXISTS payout_quantity_rule  jsonb NOT NULL DEFAULT '{"kind":"actual"}'::jsonb;

COMMENT ON COLUMN course_unit_rates.revenue_quantity_rule IS
  '売上数量ルール。actual または minimum(scope=report, minimum=N)';
COMMENT ON COLUMN course_unit_rates.payout_quantity_rule IS
  '支払数量ルール。actual または minimum(scope=report, minimum=N)';
