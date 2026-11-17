-- 修正開始・終了の記録。画面・更新ガードの接続を含む公開単位で適用する。
BEGIN;
CREATE TABLE public.shift_correction_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  shift_date date NOT NULL,
  opened_by uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  original_approved_reports uuid[] NOT NULL DEFAULT '{}',
  closed_by uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  closed_at timestamptz
);
CREATE UNIQUE INDEX shift_correction_sessions_open_unique
  ON public.shift_correction_sessions(org_id,driver_id,shift_date) WHERE closed_at IS NULL;
ALTER TABLE public.shift_correction_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_correction_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shift_correction_sessions TO service_role;
-- 日報の既存シフト連動トリガーが同じ保護判定を実行できるよう、読み取り列を限定する。
GRANT SELECT(org_id,driver_id,shift_date,closed_at) ON public.shift_correction_sessions TO hakotora_shift_report_sync;
CREATE POLICY shift_correction_sync_read ON public.shift_correction_sessions FOR SELECT TO hakotora_shift_report_sync USING (true);

CREATE FUNCTION public.begin_shift_correction(p_org uuid, p_actor uuid, p_driver uuid, p_date date, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
SET lock_timeout = '5s' SET statement_timeout = '15s' AS $$
DECLARE session_id uuid; approved_ids uuid[];
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_driver IS NULL OR p_date IS NULL OR (p_reason IS NOT NULL AND length(btrim(p_reason)) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'Invalid correction' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=p_actor AND org_id=p_org AND status='active') THEN
    RAISE EXCEPTION 'Invalid actor' USING ERRCODE='P0001';
  END IF;
  PERFORM 1 FROM public.drivers WHERE id=p_driver AND org_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid driver' USING ERRCODE='P0002'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_driver::text || ':' || p_date::text || ':correction',0)) THEN
    RAISE EXCEPTION 'Correction changed' USING ERRCODE='40001';
  END IF;
  SELECT coalesce(array_agg(r.id ORDER BY r.id),'{}'::uuid[]) INTO approved_ids FROM public.daily_reports_v2 r
    WHERE r.org_id=p_org AND r.driver_id=p_driver AND r.report_date=p_date AND r.approved_at IS NOT NULL AND r.rejected_at IS NULL;
  INSERT INTO public.shift_correction_sessions(org_id,driver_id,shift_date,opened_by,reason,original_approved_reports)
    VALUES(p_org,p_driver,p_date,p_actor,btrim(p_reason),approved_ids)
    ON CONFLICT (org_id,driver_id,shift_date) WHERE closed_at IS NULL DO NOTHING
    RETURNING id INTO session_id;
  IF session_id IS NULL THEN RAISE EXCEPTION 'Correction already open' USING ERRCODE='23505'; END IF;
  RETURN session_id;
END $$;
REVOKE ALL ON FUNCTION public.begin_shift_correction(uuid,uuid,uuid,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_shift_correction(uuid,uuid,uuid,date,text) TO service_role;

-- シフトの全入口を同じ境界で保護する。修正中のセルのみ例外とする。
CREATE FUNCTION public.guard_finalized_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE item record; v_org uuid; locked boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN RETURN NEW; END IF;
  FOR item IN
    SELECT x.driver_id, x.shift_date, x.course_id FROM (
      SELECT CASE WHEN TG_OP <> 'INSERT' THEN OLD.driver_id END AS driver_id,
             CASE WHEN TG_OP <> 'INSERT' THEN OLD.shift_date END AS shift_date,
             CASE WHEN TG_OP <> 'INSERT' THEN OLD.course_id END AS course_id
      UNION
      SELECT CASE WHEN TG_OP <> 'DELETE' THEN NEW.driver_id END,
             CASE WHEN TG_OP <> 'DELETE' THEN NEW.shift_date END,
             CASE WHEN TG_OP <> 'DELETE' THEN NEW.course_id END
    ) x WHERE x.driver_id IS NOT NULL
  LOOP
    SELECT org_id INTO v_org FROM public.courses WHERE id=item.course_id;
    IF v_org IS NULL THEN RAISE EXCEPTION 'シフトの所属を確認できません' USING ERRCODE='23514'; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended(v_org::text || ':' || item.driver_id::text || ':' || item.shift_date::text || ':correction',0)) THEN
      RAISE EXCEPTION 'シフトを確認し直してください' USING ERRCODE='40001';
    END IF;
    SELECT item.shift_date < (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date INTO locked;
    IF locked AND NOT EXISTS (SELECT 1 FROM public.shift_correction_sessions s WHERE s.org_id=v_org
      AND s.driver_id=item.driver_id AND s.shift_date=item.shift_date AND s.closed_at IS NULL) THEN
      RAISE EXCEPTION '確定済みのシフトです。確定を解除してから修正してください' USING ERRCODE='23514', CONSTRAINT='finalized_shift';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_finalized_shift() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_finalized_shift BEFORE INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.guard_finalized_shift();

-- 日報の確定・修正も同じロックを取る。承認済みの変更は修正開始後だけ許す。
CREATE FUNCTION public.guard_finalized_report() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE lock_key text;
BEGIN
  FOR lock_key IN SELECT DISTINCT k FROM (VALUES
    (CASE WHEN TG_OP <> 'INSERT' THEN OLD.org_id::text || ':' || OLD.driver_id::text || ':' || OLD.report_date::text || ':correction' END),
    (CASE WHEN TG_OP <> 'DELETE' THEN NEW.org_id::text || ':' || NEW.driver_id::text || ':' || NEW.report_date::text || ':correction' END)
  ) AS keys(k) WHERE k IS NOT NULL ORDER BY k LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(lock_key,0)) THEN
      RAISE EXCEPTION '日報を確認し直してください' USING ERRCODE='40001';
    END IF;
  END LOOP;
  IF TG_OP <> 'INSERT' AND OLD.approved_at IS NOT NULL AND OLD.report_date < ((clock_timestamp() AT TIME ZONE 'Asia/Tokyo') - interval '3 hours')::date AND (TG_OP = 'DELETE' OR to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW))
    AND NOT EXISTS (SELECT 1 FROM public.shift_correction_sessions s WHERE s.org_id=OLD.org_id
      AND s.driver_id=OLD.driver_id AND s.shift_date=OLD.report_date AND s.closed_at IS NULL) THEN
    RAISE EXCEPTION '確定済みの日報です。確定を解除してから修正してください' USING ERRCODE='23514', CONSTRAINT='finalized_report';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_finalized_report() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_finalized_report BEFORE INSERT OR UPDATE OR DELETE ON public.daily_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.guard_finalized_report();

CREATE FUNCTION public.guard_finalized_report_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE report record;
BEGIN
  FOR report IN SELECT r.id,r.org_id,r.driver_id,r.report_date,r.approved_at FROM public.daily_reports_v2 r
    WHERE r.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.report_id END,
                   CASE WHEN TG_OP <> 'DELETE' THEN NEW.report_id END) ORDER BY r.id FOR UPDATE
  LOOP
    IF report.org_id IS NOT NULL AND report.driver_id IS NOT NULL AND report.report_date IS NOT NULL
      AND NOT pg_try_advisory_xact_lock(hashtextextended(report.org_id::text || ':' || report.driver_id::text || ':' || report.report_date::text || ':correction',0)) THEN
      RAISE EXCEPTION '日報を確認し直してください' USING ERRCODE='40001';
    END IF;
    IF report.approved_at IS NOT NULL AND report.report_date < ((clock_timestamp() AT TIME ZONE 'Asia/Tokyo') - interval '3 hours')::date AND NOT EXISTS (SELECT 1 FROM public.shift_correction_sessions s
      WHERE s.org_id=report.org_id AND s.driver_id=report.driver_id AND s.shift_date=report.report_date AND s.closed_at IS NULL) THEN
      RAISE EXCEPTION '確定済みの日報です。確定を解除してから修正してください' USING ERRCODE='23514', CONSTRAINT='finalized_report_entry';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_finalized_report_entry() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_finalized_report_entry BEFORE INSERT OR UPDATE OR DELETE ON public.report_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_finalized_report_entry();

CREATE FUNCTION public.finish_shift_correction(p_org uuid, p_actor uuid, p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
SET lock_timeout = '5s' SET statement_timeout = '15s' AS $$
DECLARE correction public.shift_correction_sessions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id=p_actor AND org_id=p_org AND status='active') THEN
    RAISE EXCEPTION 'Invalid actor' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO correction FROM public.shift_correction_sessions WHERE id=p_session AND org_id=p_org AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Correction not found' USING ERRCODE='P0002'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text || ':' || correction.driver_id::text || ':' || correction.shift_date::text || ':correction',0)) THEN
    RAISE EXCEPTION 'Correction changed' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=correction.driver_id
       AND r.report_date=correction.shift_date AND r.rejected_at IS NULL AND r.approved_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.report_course_requests q WHERE q.org_id=p_org AND q.driver_id=correction.driver_id
       AND q.report_date=correction.shift_date AND q.status='pending') THEN
    RAISE EXCEPTION '日報を承認してから確定してください' USING ERRCODE='23514', CONSTRAINT='correction_pending_reports';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(correction.original_approved_reports) AS original(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.daily_reports_v2 r WHERE r.id=original.id AND r.org_id=p_org AND r.driver_id=correction.driver_id
      AND r.report_date=correction.shift_date AND ((r.approved_at IS NOT NULL AND r.rejected_at IS NULL)
        OR (r.rejected_at IS NOT NULL AND r.rejection_reason='shift_changed'))))
    OR (cardinality(correction.original_approved_reports) > 0 AND NOT EXISTS (
      SELECT 1 FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=correction.driver_id
        AND r.report_date=correction.shift_date AND r.approved_at IS NOT NULL AND r.rejected_at IS NULL)) THEN
    RAISE EXCEPTION '修正前の日報を確認してください' USING ERRCODE='23514', CONSTRAINT='correction_missing_original';
  END IF;
  UPDATE public.shift_correction_sessions SET closed_at=clock_timestamp(), closed_by=p_actor WHERE id=correction.id;
END $$;
REVOKE ALL ON FUNCTION public.finish_shift_correction(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_shift_correction(uuid,uuid,uuid) TO service_role;
COMMIT;
