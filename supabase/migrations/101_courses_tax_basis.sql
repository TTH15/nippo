-- コースの単価が「契約上、税抜と税込のどちらで決まっているか」を記録する。
-- course_unit_rates / course_fixed_rates の保存値は従来どおり常に税抜だが（内部の売上・利益集計は
-- これに依存しており変更しない）、取引先へ実際に請求する金額は税込で決まっているコースもある
-- （例: 宅急便160円税込で契約 → 保存値は145円税抜、取引先への実請求は160円）。
-- このフラグは請求書のペア生成（税込＝取引先送付用／税抜＝税務提出用）機能が参照する。
ALTER TABLE courses ADD COLUMN IF NOT EXISTS revenue_tax_basis text NOT NULL DEFAULT 'exclusive';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS payout_tax_basis text NOT NULL DEFAULT 'exclusive';

ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_revenue_tax_basis_check;
ALTER TABLE courses ADD CONSTRAINT courses_revenue_tax_basis_check
  CHECK (revenue_tax_basis IN ('exclusive', 'inclusive'));

ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_payout_tax_basis_check;
ALTER TABLE courses ADD CONSTRAINT courses_payout_tax_basis_check
  CHECK (payout_tax_basis IN ('exclusive', 'inclusive'));
