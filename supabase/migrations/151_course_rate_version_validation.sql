-- 単価履歴を「保存ログ」から「単価の正本」へ格上げする準備。
-- 過去日の集計を遡って作り直す入力になるため、値が壊れた版が1件あるだけで
-- 売上が数十万円動く（2026-08-28 の事故: 西宇治の7月末版に税抜15円が入っていた）。
-- 検証に落ちた版は理由を記録し、スナップショット生成の対象から外す。
ALTER TABLE course_rate_versions
  ADD COLUMN IF NOT EXISTS invalid_reason text;

-- 適用日を指定して保存すると、その日以降の版は上書き（削除して1件に置換）する。
-- 版は常に一直線に並ぶため、適用終了日は次versionの前日として導出し列では持たない。
CREATE INDEX IF NOT EXISTS idx_course_rate_versions_valid
  ON course_rate_versions (course_id, effective_from DESC)
  WHERE invalid_reason IS NULL;

COMMENT ON COLUMN course_rate_versions.invalid_reason IS
  '値の検証に落ちた理由。NULL 以外の版はスナップショット生成に使わない';
