-- コースにキャリア（ヤマト / Amazon / その他）を追加
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS carrier text NOT NULL DEFAULT 'OTHER'
    CHECK (carrier IN ('YAMATO', 'AMAZON', 'OTHER'));

COMMENT ON COLUMN courses.carrier IS 'YAMATO=ヤマト, AMAZON=Amazon, OTHER=その他';
