-- daily_reports に Amazon 用カラムと承認用カラムを追加

-- 配送種別（ヤマト / Amazon）
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS carrier text NOT NULL DEFAULT 'YAMATO'
    CHECK (carrier IN ('YAMATO', 'AMAZON'));

-- 承認情報
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES drivers(id) ON DELETE SET NULL;

-- Amazon 日報用カラム
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS amazon_am_mochidashi int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amazon_am_completed int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amazon_pm_mochidashi int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amazon_pm_completed int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amazon_4_mochidashi int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amazon_4_completed int NOT NULL DEFAULT 0;

