-- 未実行。本番反映の確認後に、この1件のみ補正する。
-- 日報・明細・単価記録を削除せず、既存の却下状態にする。全日報への一括適用は禁止。
BEGIN;
SET LOCAL lock_timeout = '2s';
SELECT pg_advisory_xact_lock(hashtextextended(
  '1314c7a1-0f86-44fd-8f60-01588735295a:1caf7a0b-dc28-44ab-b360-2162ccca4086:2026-10-16:3bebe380-ded7-4f8c-b99d-3112eaa0adc2:0', 0));
DO $$
DECLARE target public.daily_reports_v2%ROWTYPE;
BEGIN
  SELECT * INTO STRICT target FROM public.daily_reports_v2
  WHERE id = '55863900-6455-470f-a941-e38af56b56eb'
    AND org_id = '1314c7a1-0f86-44fd-8f60-01588735295a'
    AND driver_id = '1caf7a0b-dc28-44ab-b360-2162ccca4086'
    AND report_date = '2026-10-16'
    AND course_id = '3bebe380-ded7-4f8c-b99d-3112eaa0adc2' AND cycle_no = 0
    AND submitted_at = '2026-10-16T13:09:01.464Z'
  FOR UPDATE;
  IF EXISTS (SELECT FROM public.shifts s WHERE s.driver_id = target.driver_id
    AND s.shift_date = target.report_date AND s.course_id = target.course_id
    AND COALESCE(s.cycle_no, 0) = target.cycle_no)
  THEN RAISE EXCEPTION 'シフトが再登録されています。補正対象を再確認してください。'; END IF;
  IF target.rejected_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.daily_reports_v2
  SET approved_at = NULL, approved_by = NULL, rejected_at = clock_timestamp(), rejected_by = NULL, rejection_reason = 'shift_changed'
  WHERE id = target.id AND org_id = target.org_id AND rejected_at IS NULL;
END $$;
SELECT id, report_date, course_id, approved_at, rejected_at
FROM public.daily_reports_v2
WHERE org_id = '1314c7a1-0f86-44fd-8f60-01588735295a'
  AND driver_id = '1caf7a0b-dc28-44ab-b360-2162ccca4086' AND report_date = '2026-10-16';
COMMIT;
