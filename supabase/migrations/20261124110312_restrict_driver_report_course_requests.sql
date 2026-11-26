-- 日報の一括送信・単独申請で共通の保存入口を制限する。既存の正式日報と承認操作は変更しない。
BEGIN;
CREATE OR REPLACE FUNCTION public.save_report_course_request(p_org uuid, p_driver uuid, p_date date, p_course uuid, p_cycle integer, p_payload jsonb, p_expected text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
SET lock_timeout = '5s' SET statement_timeout = '15s' AS $$
DECLARE result_id uuid;
BEGIN
  IF p_org IS NULL OR p_driver IS NULL OR p_date IS NULL OR p_course IS NULL OR p_cycle IS NULL OR p_cycle < 0
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id=p_driver AND d.org_id=p_org AND d.status='active' AND d.works_as_driver) THEN
    RAISE EXCEPTION 'Invalid driver' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id=p_course AND c.org_id=p_org AND c.archived_at IS NULL
    AND ((NOT coalesce(c.uses_cycles,false) AND p_cycle=0) OR (c.uses_cycles AND EXISTS
      (SELECT 1 FROM public.course_cycles cc WHERE cc.course_id=c.id AND cc.cycle_no=p_cycle AND cc.active IS DISTINCT FROM false)))) THEN
    RAISE EXCEPTION 'Invalid course or cycle' USING ERRCODE='P0002';
  END IF;
  -- 同じ日・ドライバーの割当変更と競合したときだけ再確認を求める。
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_driver::text || ':' || p_date::text || ':correction',0)) THEN
    RAISE EXCEPTION 'Shift changed' USING ERRCODE='40001';
  END IF;
  IF p_expected IS NOT NULL THEN
    IF p_expected IS DISTINCT FROM public.report_day_revision(p_org,p_driver,p_date) THEN
      RAISE EXCEPTION '日報が変更されています。再読み込みしてください' USING ERRCODE='40001';
    END IF;
  END IF;
  -- 既存の承認待ちは編集できる。新規申請のみ、本人に紐づくコース・便に限定。
  -- 勤務区分を切り替えても、同じドライバーの別区分で担当するコースは対象。
  PERFORM 1 FROM public.report_course_requests q WHERE q.org_id=p_org AND q.driver_id=p_driver
    AND q.report_date=p_date AND q.course_id=p_course AND q.cycle_no=p_cycle AND q.status='pending' FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM 1 FROM public.driver_courses dc
      JOIN public.driver_identities di ON di.id=dc.driver_identity_id AND di.driver_id=p_driver
      WHERE dc.course_id=p_course AND dc.cycle_no IN (0,p_cycle) FOR SHARE OF dc,di;
    IF NOT FOUND THEN
      RAISE EXCEPTION '担当コースの設定を確認してください。必要な場合は運営に連絡してください' USING ERRCODE='23514';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts s WHERE s.driver_id=p_driver AND s.shift_date=p_date AND s.course_id=p_course AND coalesce(s.cycle_no,0)=p_cycle) AND NOT EXISTS (SELECT FROM public.report_course_requests q WHERE q.org_id=p_org AND q.driver_id=p_driver AND q.report_date=p_date AND q.course_id=p_course AND q.cycle_no=p_cycle AND q.status='pending') THEN
    RAISE EXCEPTION 'Already assigned' USING ERRCODE='23514';
  END IF;
  IF p_cycle > 0 AND EXISTS (SELECT 1 FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=p_driver
    AND r.report_date=p_date AND r.course_id=p_course AND coalesce(r.cycle_no,0)=0 AND r.rejected_at IS NULL) THEN
    RAISE EXCEPTION 'Legacy whole day report' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.report_course_requests(org_id,driver_id,report_date,course_id,cycle_no,payload)
    VALUES(p_org,p_driver,p_date,p_course,p_cycle,p_payload)
    ON CONFLICT (org_id,driver_id,report_date,course_id,cycle_no) WHERE status='pending'
    DO UPDATE SET payload=excluded.payload, submitted_at=now()
    RETURNING id INTO result_id;
  RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION public.save_report_course_request(uuid,uuid,date,uuid,integer,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_report_course_request(uuid,uuid,date,uuid,integer,jsonb,text) TO service_role;
COMMIT;
