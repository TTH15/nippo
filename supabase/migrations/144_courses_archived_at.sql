-- 現在は使用しないコースを削除せず、過去の日報・請求・支払から参照できる状態で保持する。
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_courses_org_active_sort
  ON courses (org_id, sort_order)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN courses.archived_at IS
  'NULL=稼働中。日時あり=アーカイブ済み。過去計算の参照整合性を守るため物理削除しない';
