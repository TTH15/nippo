-- 承認時点の適用単価・計算結果。単価マスタ変更後も過去集計を固定する。
ALTER TABLE daily_reports_v2
  ADD COLUMN IF NOT EXISTS rate_snapshot jsonb;

COMMENT ON COLUMN daily_reports_v2.rate_snapshot IS
  '承認時の契約単価・入力基準・税抜計算結果。未承認/旧データはNULLで従来計算へフォールバック';
