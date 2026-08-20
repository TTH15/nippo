-- コース単価の適用開始日付き履歴。終了日は次のversionの前日として導出する。
-- 現行rateテーブルは高速な現在値として維持し、承認時snapshotはこの履歴から適用値を選ぶ。
CREATE TABLE IF NOT EXISTS course_rate_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  rate_data      jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES drivers(id) ON DELETE SET NULL,
  UNIQUE (course_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_course_rate_versions_lookup
  ON course_rate_versions (course_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_course_rate_versions_org
  ON course_rate_versions (org_id, effective_from DESC);

COMMENT ON TABLE course_rate_versions IS
  '適用開始日付きの契約単価履歴。次versionの前日まで有効。承認時rate_snapshotの入力元';
