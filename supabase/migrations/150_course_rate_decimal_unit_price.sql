-- 契約単価に小数を許す（例: 157.5円/個）。
-- 金額（行合計・請求額）は従来どおり円単位の整数で、丸めは行合計で1回だけ行う。
-- 契約原額列(*_contract_amount)は 137 で既に numeric。ここでは集計用の単価列を numeric 化する。

ALTER TABLE course_unit_rates
  ALTER COLUMN revenue_per_unit TYPE numeric(12, 2),
  ALTER COLUMN profit_per_unit  TYPE numeric(12, 2),
  ALTER COLUMN payout_per_unit  TYPE numeric(12, 2);

ALTER TABLE course_fixed_rates
  ALTER COLUMN fixed_revenue TYPE numeric(12, 2),
  ALTER COLUMN fixed_profit  TYPE numeric(12, 2),
  ALTER COLUMN fixed_payout  TYPE numeric(12, 2);

-- 全サイクル稼働時の日当。CHECK 制約は型変更後も有効。
ALTER TABLE course_fixed_rate_bundles
  ALTER COLUMN fixed_revenue TYPE numeric(12, 2),
  ALTER COLUMN fixed_payout  TYPE numeric(12, 2),
  ALTER COLUMN revenue_contract_amount TYPE numeric(12, 2),
  ALTER COLUMN payout_contract_amount  TYPE numeric(12, 2);

COMMENT ON COLUMN course_unit_rates.revenue_per_unit IS '売上単価/個（税抜・小数可）';
COMMENT ON COLUMN course_unit_rates.payout_per_unit IS 'ドライバー支払単価/個（税抜・小数可）';
COMMENT ON COLUMN course_unit_rates.profit_per_unit IS '利益/個（税抜・売上−支払の導出値）';
