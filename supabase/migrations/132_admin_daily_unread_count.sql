-- ============================================================
-- 管理バッジ「日報の要対応件数」を DB 側で数える関数。
--
-- 従来はアプリ側（/api/admin/daily/unread-count）が 2020-01-01〜今日の
-- shifts 全件と日報全件を毎回転送して JS で数えており、どの管理画面でも
-- 60秒ごとに全履歴走査が走っていた（2026-08 通信監査の最重量項目）。
-- COUNT を Postgres 側で行い、転送を数値1個に置き換える。
--
-- ★条件はアプリ側 countDailyUnreadAppSide のフォールバック実装と
--   完全に揃えること（変更時は両方を修正する）:
--   「シフトがある org ドライバー×日」のうち、
--   ① 非却下の日報が1件も無い（未提出）
--   ② シフトの担当コースのうち日報が無いコースがある（一部未提出）
--   ③ 非却下の日報に未承認がある
--   のいずれかに当たるセル数。
-- ============================================================

CREATE OR REPLACE FUNCTION admin_daily_unread_count(p_org uuid, p_start date, p_end date)
RETURNS integer
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
  SELECT COALESCE(count(*), 0)::int
  FROM cells c
  WHERE
    -- ① 日報未提出
    NOT EXISTS (
      SELECT 1 FROM rep r
      WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
    )
    -- ② 一部コース未提出
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
    -- ③ 未承認あり
    OR EXISTS (
      SELECT 1 FROM rep r
      WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
        AND r.approved_at IS NULL
    );
$$;

COMMENT ON FUNCTION admin_daily_unread_count(uuid, date, date) IS
  '日報の要対応件数（未提出/一部コース未提出/未承認のシフト×日セル数）。管理バッジ用';
