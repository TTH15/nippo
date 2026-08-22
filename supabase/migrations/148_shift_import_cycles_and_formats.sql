-- シフト表AI取り込みをコースのサイクル（C1/C2等）まで記憶できるようにし、
-- 確定済みの表構造だけを翌月以降の高速読み取りに再利用する。
-- 元ファイルや抽出した氏名・シフト内容はキャッシュしない。

ALTER TABLE shift_import_label_maps
  ADD COLUMN IF NOT EXISTS cycle_no int NOT NULL DEFAULT 0;

ALTER TABLE shift_import_label_maps
  DROP CONSTRAINT IF EXISTS shift_import_label_maps_cycle_no_check;

ALTER TABLE shift_import_label_maps
  ADD CONSTRAINT shift_import_label_maps_cycle_no_check CHECK (cycle_no >= 0);

CREATE TABLE IF NOT EXISTS shift_import_format_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  format_key text NOT NULL,
  mime_type text NOT NULL,
  layout_profile text NOT NULL,
  use_count int NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, format_key)
);

CREATE INDEX IF NOT EXISTS idx_shift_import_format_profiles_org
  ON shift_import_format_profiles (org_id, last_used_at DESC);

COMMENT ON COLUMN shift_import_label_maps.cycle_no IS '確定済みラベルが指す便。0=全サイクルまたは便なし';
COMMENT ON TABLE shift_import_format_profiles IS
  '確定済みシフト表の構造プロファイル。元ファイル・氏名・日別割当は保存せず、翌月の高速読み取りに利用する';
