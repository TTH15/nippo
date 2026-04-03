-- ============================================================
-- oil_change_reports: 報告種別（オイル以外：修理・単発など）と内容
-- ============================================================

ALTER TABLE oil_change_reports
  ADD COLUMN IF NOT EXISTS report_kind text NOT NULL DEFAULT 'oil_change',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

-- odometer の NOT NULL / CHECK を外して NULL 許容にする（制約名は環境で異なることがある）
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'oil_change_reports'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%odometer_km%'
  LOOP
    EXECUTE format('ALTER TABLE oil_change_reports DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE oil_change_reports
  ALTER COLUMN odometer_km DROP NOT NULL;

ALTER TABLE oil_change_reports
  ADD CONSTRAINT oil_change_reports_odometer_km_nonneg CHECK (odometer_km IS NULL OR odometer_km >= 0);

ALTER TABLE oil_change_reports
  ADD CONSTRAINT oil_change_reports_kind_allowed CHECK (
    report_kind IN ('oil_change', 'repair', 'one_off', 'other')
  );

ALTER TABLE oil_change_reports
  ADD CONSTRAINT oil_change_reports_oil_fields CHECK (
    report_kind <> 'oil_change'
    OR (odometer_km IS NOT NULL AND length(trim(location)) >= 1)
  );

ALTER TABLE oil_change_reports
  ADD CONSTRAINT oil_change_reports_misc_fields CHECK (
    report_kind = 'oil_change'
    OR (length(trim(description)) >= 1 AND length(trim(location)) >= 1)
  );
