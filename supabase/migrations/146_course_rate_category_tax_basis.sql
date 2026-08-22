-- 日当と歩合は別契約になり得るため、売上/支払 × 固定/歩合で税基準を分離する。
-- 旧 revenue_tax_basis / payout_tax_basis は後方互換用として保持する。
-- このmigrationはコースマスターの税区分だけを補完する。
-- daily_reports_v2 / report_entries / 数量・金額の既存列は更新しない。
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS revenue_piece_tax_basis text,
  ADD COLUMN IF NOT EXISTS payout_piece_tax_basis text,
  ADD COLUMN IF NOT EXISTS revenue_fixed_tax_basis text,
  ADD COLUMN IF NOT EXISTS payout_fixed_tax_basis text;

UPDATE courses SET
  revenue_piece_tax_basis = COALESCE(revenue_piece_tax_basis, revenue_tax_basis, 'exclusive'),
  payout_piece_tax_basis = COALESCE(payout_piece_tax_basis, payout_tax_basis, 'exclusive'),
  revenue_fixed_tax_basis = COALESCE(revenue_fixed_tax_basis, revenue_tax_basis, 'exclusive'),
  payout_fixed_tax_basis = COALESCE(payout_fixed_tax_basis, payout_tax_basis, 'exclusive')
WHERE revenue_piece_tax_basis IS NULL
   OR payout_piece_tax_basis IS NULL
   OR revenue_fixed_tax_basis IS NULL
   OR payout_fixed_tax_basis IS NULL;

ALTER TABLE courses
  ALTER COLUMN revenue_piece_tax_basis SET DEFAULT 'exclusive',
  ALTER COLUMN revenue_piece_tax_basis SET NOT NULL,
  ALTER COLUMN payout_piece_tax_basis SET DEFAULT 'exclusive',
  ALTER COLUMN payout_piece_tax_basis SET NOT NULL,
  ALTER COLUMN revenue_fixed_tax_basis SET DEFAULT 'exclusive',
  ALTER COLUMN revenue_fixed_tax_basis SET NOT NULL,
  ALTER COLUMN payout_fixed_tax_basis SET DEFAULT 'exclusive',
  ALTER COLUMN payout_fixed_tax_basis SET NOT NULL;

ALTER TABLE courses
  DROP CONSTRAINT IF EXISTS courses_revenue_piece_tax_basis_check,
  DROP CONSTRAINT IF EXISTS courses_payout_piece_tax_basis_check,
  DROP CONSTRAINT IF EXISTS courses_revenue_fixed_tax_basis_check,
  DROP CONSTRAINT IF EXISTS courses_payout_fixed_tax_basis_check;

ALTER TABLE courses
  ADD CONSTRAINT courses_revenue_piece_tax_basis_check CHECK (revenue_piece_tax_basis IN ('exclusive', 'inclusive')),
  ADD CONSTRAINT courses_payout_piece_tax_basis_check CHECK (payout_piece_tax_basis IN ('exclusive', 'inclusive')),
  ADD CONSTRAINT courses_revenue_fixed_tax_basis_check CHECK (revenue_fixed_tax_basis IN ('exclusive', 'inclusive')),
  ADD CONSTRAINT courses_payout_fixed_tax_basis_check CHECK (payout_fixed_tax_basis IN ('exclusive', 'inclusive'));

COMMENT ON COLUMN courses.revenue_piece_tax_basis IS '売上歩合の契約税基準';
COMMENT ON COLUMN courses.payout_piece_tax_basis IS '支払歩合の契約税基準';
COMMENT ON COLUMN courses.revenue_fixed_tax_basis IS '売上日当の契約税基準';
COMMENT ON COLUMN courses.payout_fixed_tax_basis IS '支払日当の契約税基準';
