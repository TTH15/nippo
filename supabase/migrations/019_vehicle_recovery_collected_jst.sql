-- 018 で timestamptz で作成済みの場合の修正：日本時間の日付のみに統一
-- （018 を未適用の場合は 018 の定義で date 型になるため、このマイグレーションは安全にスキップされる）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_recovery_collected'
    AND column_name = 'collected_at'
    AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE vehicle_recovery_collected
      ALTER COLUMN collected_at TYPE date
      USING collected_at::date;
  END IF;
END $$;
