-- ============================================================
-- 日報「要対応」ビューの対象日を DB 側で確定する関数。
--
-- 従来はアプリ側（/api/admin/daily/day-summary-range?pending=1）が
-- 2020-01-01〜今日の shifts 全件+日報全件（entries 込み）を毎回転送して
-- JS で「要対応が残る日」を選んでいた（2026-08 通信監査）。
-- 日付の確定を Postgres 側で行い、アプリは確定した日だけを読み込む。
--
-- ★条件はアプリ側 loadPendingDatesAppSide のフォールバック実装と
--   完全に揃えること（変更時は両方を修正する）:
--   ① 非却下の日報に未承認がある日（シフト有無に関わらず表示＝現行UIと同一）
--   ② シフトがある org ドライバーに日報ゼロ／担当コースの一部が未提出の日
-- ============================================================

CREATE OR REPLACE FUNCTION admin_daily_pending_dates(p_org uuid, p_start date, p_end date)
RETURNS SETOF date
LANGUAGE sql
STABLE
AS $$
  WITH org_drivers AS (
    SELECT id FROM drivers
    WHERE org_id = p_org AND works_as_driver = true
  ),
  sh AS (
    SELECT s.shift_date, s.driver_id, s.course_id
    FROM shifts s
    JOIN org_drivers d ON d.id = s.driver_id
    WHERE s.shift_date BETWEEN p_start AND p_end
  ),
  rep AS (
    SELECT r.report_date, r.driver_id, r.course_id, r.approved_at
    FROM daily_reports_v2 r
    WHERE r.org_id = p_org
      AND r.report_date BETWEEN p_start AND p_end
      AND r.rejected_at IS NULL
  ),
  cells AS (
    SELECT DISTINCT shift_date, driver_id FROM sh
  )
  SELECT DISTINCT t.d
  FROM (
    -- ① 未承認の日報がある日
    SELECT r.report_date AS d FROM rep r WHERE r.approved_at IS NULL
    UNION
    -- ② シフトがあるのに日報ゼロ／一部コース未提出の日
    SELECT c.shift_date AS d
    FROM cells c
    WHERE
      NOT EXISTS (
        SELECT 1 FROM rep r
        WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
      )
      OR EXISTS (
        SELECT 1 FROM sh
        WHERE sh.shift_date = c.shift_date AND sh.driver_id = c.driver_id
          AND sh.course_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM rep r
            WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
              AND r.course_id = sh.course_id
          )
      )
  ) t
  ORDER BY 1;
$$;

COMMENT ON FUNCTION admin_daily_pending_dates(uuid, date, date) IS
  '日報の要対応（未提出/一部コース未提出/未承認）が残る日付の一覧。要対応ビュー用';
