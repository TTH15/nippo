-- ============================================================
-- 174〜179 で足した複合外部キーを外す（2026-09-19・本番障害の収束）。
--
-- 症状: シフト表が「シフトを読み込めませんでした」になり、
--       GET /api/admin/shifts が 500（PostgREST の **PGRST201**）。
--
-- 原因: 既存の単一列FK（例 course_cycles_course_id_fkey）に加えて
--       複合FK（course_cycles_org_fk）を足したため、**同じ親への関係が2本**になり、
--       PostgREST の埋め込み（.select("*, course_cycles(...)") など）が
--       どちらの関係を使うか決められなくなった。
--       スキーマ変更だけで起きるため、アプリのテストでは検出できなかった。
--
-- 方針: 複合FKは外し、**org_id 列と索引・backfill はそのまま残す**。
--       列さえあれば `check:tenant` は対象として見るので、
--       アプリ層の二重防御（今回の主目的）は維持される。
--       DBレベルで「他社をまたぐ参照」を禁じる仕組みは、埋め込みを壊さない形
--       （トリガや CHECK）で別途入れ直す。
-- ============================================================
BEGIN;

ALTER TABLE public.course_cycles              DROP CONSTRAINT IF EXISTS course_cycles_org_fk;
ALTER TABLE public.course_fixed_rate_bundles  DROP CONSTRAINT IF EXISTS course_fixed_rate_bundles_org_fk;
ALTER TABLE public.course_fixed_rates         DROP CONSTRAINT IF EXISTS course_fixed_rates_org_fk;
ALTER TABLE public.course_rates               DROP CONSTRAINT IF EXISTS course_rates_org_fk;
ALTER TABLE public.course_report_fields       DROP CONSTRAINT IF EXISTS course_report_fields_org_fk;
ALTER TABLE public.course_unit_rates          DROP CONSTRAINT IF EXISTS course_unit_rates_org_fk;
ALTER TABLE public.daily_reports              DROP CONSTRAINT IF EXISTS daily_reports_org_driver_fk;
ALTER TABLE public.driver_ad_hoc_expenses     DROP CONSTRAINT IF EXISTS driver_ad_hoc_expenses_org_driver_fk;
ALTER TABLE public.driver_courses             DROP CONSTRAINT IF EXISTS driver_courses_org_course_fk;
ALTER TABLE public.driver_courses             DROP CONSTRAINT IF EXISTS driver_courses_org_driver_fk;
ALTER TABLE public.driver_fixed_expenses      DROP CONSTRAINT IF EXISTS driver_fixed_expenses_org_driver_fk;
ALTER TABLE public.driver_leases              DROP CONSTRAINT IF EXISTS driver_leases_org_driver_fk;
ALTER TABLE public.driver_optional_expenses   DROP CONSTRAINT IF EXISTS driver_optional_expenses_org_driver_fk;
ALTER TABLE public.driver_request_slots       DROP CONSTRAINT IF EXISTS driver_request_slots_org_fk;
ALTER TABLE public.driver_vehicle_preferences DROP CONSTRAINT IF EXISTS driver_vehicle_preferences_org_fk;
ALTER TABLE public.report_entries             DROP CONSTRAINT IF EXISTS report_entries_org_report_fk;
ALTER TABLE public.shift_request_logs         DROP CONSTRAINT IF EXISTS shift_request_logs_org_driver_fk;
ALTER TABLE public.shift_requests             DROP CONSTRAINT IF EXISTS shift_requests_org_driver_fk;
ALTER TABLE public.shifts                     DROP CONSTRAINT IF EXISTS shifts_org_course_fk;
ALTER TABLE public.shifts                     DROP CONSTRAINT IF EXISTS shifts_org_driver_fk;

COMMIT;
