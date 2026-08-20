-- 税込契約額を税抜へ変換した際の丸め差を、編集画面で失わないための原額。
-- 集計は従来どおり *_revenue / *_payout（税抜）を使用する。
ALTER TABLE course_unit_rates
  ADD COLUMN IF NOT EXISTS revenue_contract_amount numeric,
  ADD COLUMN IF NOT EXISTS payout_contract_amount numeric;

ALTER TABLE course_fixed_rates
  ADD COLUMN IF NOT EXISTS revenue_contract_amount numeric,
  ADD COLUMN IF NOT EXISTS payout_contract_amount numeric;

COMMENT ON COLUMN course_unit_rates.revenue_contract_amount IS '契約上の売上入力原額。税込基準の往復丸め防止用';
COMMENT ON COLUMN course_unit_rates.payout_contract_amount IS '契約上の支払入力原額。税込基準の往復丸め防止用';
COMMENT ON COLUMN course_fixed_rates.revenue_contract_amount IS '契約上の固定売上入力原額。税込基準の往復丸め防止用';
COMMENT ON COLUMN course_fixed_rates.payout_contract_amount IS '契約上の固定支払入力原額。税込基準の往復丸め防止用';
