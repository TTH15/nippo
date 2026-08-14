-- ============================================================
-- 車両×月の日額リース自動計上を DB 側で集計する関数（車両一覧の高速化）。
--
-- 従来はアプリ側（loadDailyLeaseByVehicleMonth）が承認済み日報の全履歴を
-- range ページングで転送してから集計しており、日報件数に比例して遅くなっていた
-- （2026-08-14 時点で 1,230 件、毎日増える）。GROUP BY を Postgres 側で行い、
-- 転送を「車両×月」の数十行に置き換える。
--
-- ★条件はアプリ側 loadDailyLeaseByVehicleMonth のフォールバック実装と
--   完全に揃えること（変更時は両方を修正する）:
--   承認済み（approved_at あり・rejected_at なし）・vehicle_id/course_id あり・
--   ドライバーがその日 DAILY リース有効・コースの daily_lease > 0
-- ============================================================

CREATE OR REPLACE FUNCTION vehicle_daily_lease_agg(p_org_id uuid, p_vehicle_ids uuid[] DEFAULT NULL)
RETURNS TABLE (vehicle_id uuid, ym date, amount bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT r.vehicle_id,
         date_trunc('month', r.report_date)::date AS ym,
         SUM(c.daily_lease)::bigint AS amount
  FROM daily_reports_v2 r
  JOIN courses c ON c.id = r.course_id AND c.org_id = p_org_id
  WHERE r.org_id = p_org_id
    AND r.vehicle_id IS NOT NULL
    AND r.course_id IS NOT NULL
    AND r.approved_at IS NOT NULL
    AND r.rejected_at IS NULL
    AND (p_vehicle_ids IS NULL OR r.vehicle_id = ANY(p_vehicle_ids))
    AND c.daily_lease > 0
    AND EXISTS (
      SELECT 1 FROM driver_leases dl
      WHERE dl.driver_id = r.driver_id
        AND dl.mode = 'DAILY'
        AND (dl.valid_from IS NULL OR dl.valid_from <= r.report_date)
        AND (dl.valid_to IS NULL OR dl.valid_to >= r.report_date)
    )
  GROUP BY r.vehicle_id, date_trunc('month', r.report_date)
$$;

COMMENT ON FUNCTION vehicle_daily_lease_agg(uuid, uuid[]) IS
  '車両×月の日額リース自動計上（承認済み日報×DAILYリース×コース日額）。車両一覧/回収詳細の集計用';
