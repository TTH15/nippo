-- 今後の誤解除からのみ復旧する。既存の却下履歴を推測で承認し直さない。
BEGIN;
SET LOCAL lock_timeout='2s';
LOCK TABLE public.shifts, public.daily_reports_v2, public.report_entries IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE recovery_migration_fingerprints ON COMMIT DROP AS SELECT jsonb_build_object(
'reports',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.daily_reports_v2 t),
'shifts',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.shifts t),
'entries',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.report_entries t),
'logs',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.shift_change_logs t)) AS fingerprints;
GRANT hakotora_shift_report_sync TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA public TO hakotora_shift_report_sync;
CREATE SCHEMA hakotora_shift_recovery;
REVOKE ALL ON SCHEMA hakotora_shift_recovery FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA hakotora_shift_recovery TO hakotora_shift_report_sync;
CREATE TABLE hakotora_shift_recovery.approvals (
  report_id uuid PRIMARY KEY REFERENCES public.daily_reports_v2(id) ON DELETE CASCADE,
  original_report jsonb NOT NULL,
  original_entries jsonb NOT NULL,
  required_cycles integer[] NOT NULL,
  captured_xid bigint NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rejected_at timestamptz,
  restored_at timestamptz
);
ALTER TABLE hakotora_shift_recovery.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hakotora_shift_recovery.approvals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hakotora_shift_recovery.approvals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON hakotora_shift_recovery.approvals TO hakotora_shift_report_sync;
CREATE POLICY shift_recovery_internal ON hakotora_shift_recovery.approvals TO hakotora_shift_report_sync USING(true) WITH CHECK(true);
GRANT SELECT ON public.daily_reports_v2, public.report_entries TO hakotora_shift_report_sync;
CREATE POLICY shift_report_sync_read ON public.report_entries FOR SELECT TO hakotora_shift_report_sync USING(true);
CREATE POLICY shift_report_sync_restore ON public.daily_reports_v2 FOR UPDATE TO hakotora_shift_report_sync
USING(true) WITH CHECK (
  rejected_at IS NULL AND rejection_reason IS NULL AND rejected_by IS NULL AND approved_at IS NOT NULL
  AND EXISTS(SELECT FROM hakotora_shift_recovery.approvals a WHERE a.report_id=daily_reports_v2.id
    AND a.rejected_at IS NOT NULL AND a.restored_at IS NULL
    AND (a.original_report->>'approved_at')::timestamptz=daily_reports_v2.approved_at
    AND (a.original_report->>'approved_by')::uuid IS NOT DISTINCT FROM daily_reports_v2.approved_by)
);

-- 解除と再割当の双方が送信と同じキーを取得する。複数キーは常に同じ順序。
CREATE OR REPLACE FUNCTION public.lock_shift_report_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row jsonb; new_row jsonb; assignment jsonb; org uuid; lock_key bigint;
  r public.daily_reports_v2%ROWTYPE; cycles integer[];
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND (OLD.org_id,OLD.driver_id,OLD.shift_date,OLD.course_id,OLD.cycle_no)
    IS NOT DISTINCT FROM (NEW.org_id,NEW.driver_id,NEW.shift_date,NEW.course_id,NEW.cycle_no) THEN RETURN NEW; END IF;
  IF (old_row->>'driver_id') IS NULL AND (new_row->>'driver_id') IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Shift/report changes require READ COMMITTED' USING ERRCODE='25001';
  END IF;
  FOR lock_key IN
    SELECT DISTINCT hashtextextended(c.org_id::text||':'||(v.a->>'driver_id')||':'||(v.a->>'shift_date')||':'||c.id::text||':'||cycle.n::text,0)
    FROM (VALUES(old_row),(new_row)) v(a) JOIN public.courses c ON c.id=(v.a->>'course_id')::uuid
    CROSS JOIN LATERAL (SELECT coalesce((v.a->>'cycle_no')::int,0) n UNION SELECT 0) cycle
    WHERE v.a->>'driver_id' IS NOT NULL AND c.org_id IS NOT NULL
    ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(lock_key); END LOOP;
  IF old_row->>'driver_id' IS NOT NULL THEN
    SELECT c.org_id INTO org FROM public.courses c WHERE c.id=(old_row->>'course_id')::uuid;
    FOR r IN SELECT * FROM public.daily_reports_v2 d
      WHERE d.org_id=org AND d.driver_id=(old_row->>'driver_id')::uuid
        AND d.report_date=(old_row->>'shift_date')::date AND d.course_id=(old_row->>'course_id')::uuid
        AND (coalesce(d.cycle_no,0)=coalesce((old_row->>'cycle_no')::int,0) OR coalesce(d.cycle_no,0)=0)
        AND d.approved_at IS NOT NULL AND d.submitted_at IS NOT NULL AND d.rejected_at IS NULL
      ORDER BY d.id FOR UPDATE
    LOOP
      SELECT array_agg(n ORDER BY n) INTO cycles FROM (
        SELECT DISTINCT coalesce(s.cycle_no,0) n FROM public.shifts s
        WHERE s.driver_id=r.driver_id AND s.shift_date=r.report_date AND s.course_id=r.course_id
          AND (s.org_id IS NULL OR s.org_id=r.org_id)
          AND (coalesce(r.cycle_no,0)=0 OR coalesce(s.cycle_no,0)=coalesce(r.cycle_no,0))
        UNION SELECT coalesce((old_row->>'cycle_no')::int,0)
      ) t;
      INSERT INTO hakotora_shift_recovery.approvals AS a(report_id,original_report,original_entries,required_cycles,captured_xid)
      VALUES(r.id,to_jsonb(r),(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text),'[]'::jsonb) FROM public.report_entries e WHERE e.report_id=r.id),cycles,txid_current())
      ON CONFLICT(report_id) DO UPDATE SET original_report=excluded.original_report,original_entries=excluded.original_entries,
        required_cycles=CASE WHEN a.captured_xid=txid_current() THEN ARRAY(SELECT DISTINCT n FROM unnest(a.required_cycles||excluded.required_cycles) n ORDER BY n) ELSE excluded.required_cycles END,
        captured_xid=excluded.captured_xid,captured_at=clock_timestamp(),rejected_at=NULL,restored_at=NULL;
    END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER lock_shift_report_removal ON public.shifts;
CREATE TRIGGER lock_shift_report_removal BEFORE INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.lock_shift_report_removal();

CREATE OR REPLACE FUNCTION public.reject_reports_for_removed_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org uuid; r public.daily_reports_v2%ROWTYPE; excluded_at timestamptz;
BEGIN
  IF OLD.driver_id IS NULL THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' AND (OLD.org_id,OLD.driver_id,OLD.shift_date,OLD.course_id,OLD.cycle_no)
    IS NOT DISTINCT FROM (NEW.org_id,NEW.driver_id,NEW.shift_date,NEW.course_id,NEW.cycle_no) THEN RETURN NULL; END IF;
  SELECT c.org_id INTO org FROM public.courses c WHERE c.id=OLD.course_id;
  IF org IS NULL OR EXISTS(SELECT FROM public.shifts s WHERE s.driver_id=OLD.driver_id AND s.shift_date=OLD.shift_date
    AND s.course_id=OLD.course_id AND (s.org_id IS NULL OR s.org_id=org) AND coalesce(s.cycle_no,0)=coalesce(OLD.cycle_no,0)) THEN RETURN NULL; END IF;
  FOR r IN SELECT * FROM public.daily_reports_v2 d WHERE d.org_id=org AND d.driver_id=OLD.driver_id
    AND d.report_date=OLD.shift_date AND d.course_id=OLD.course_id
    AND (coalesce(d.cycle_no,0)=coalesce(OLD.cycle_no,0) OR coalesce(d.cycle_no,0)=0)
    AND d.rejected_at IS NULL ORDER BY d.id FOR UPDATE
  LOOP
    UPDATE public.daily_reports_v2 SET approved_at=NULL,approved_by=NULL,rejected_at=clock_timestamp(),rejected_by=NULL,rejection_reason='shift_changed'
      WHERE id=r.id RETURNING rejected_at INTO excluded_at;
    UPDATE hakotora_shift_recovery.approvals SET rejected_at=excluded_at
      WHERE report_id=r.id AND captured_xid=txid_current() AND original_report=to_jsonb(r);
  END LOOP;
  RETURN NULL;
END $$;

-- 日報本体と明細を同じロック順で保護し、復旧判定中の数量変更を防ぐ。
CREATE FUNCTION public.lock_report_entry_shift_recovery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_id uuid; new_id uuid; r public.daily_reports_v2%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN old_id:=OLD.report_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.report_id; END IF;
  FOR r IN SELECT * FROM public.daily_reports_v2 WHERE id IN(old_id,new_id) ORDER BY id LOOP
    IF r.course_id IS NOT NULL THEN
      IF current_setting('transaction_isolation')<>'read committed' THEN
        RAISE EXCEPTION 'Report changes require READ COMMITTED' USING ERRCODE='25001';
      END IF;
      IF NOT pg_try_advisory_xact_lock(hashtextextended(r.org_id::text||':'||r.driver_id::text||':'||r.report_date::text||':'||r.course_id::text||':'||coalesce(r.cycle_no,0)::text,0)) THEN
        RAISE EXCEPTION 'シフトが変更されています。日報を再読み込みしてください。' USING ERRCODE='23514',CONSTRAINT='report_current_shift';
      END IF;
      PERFORM 1 FROM public.daily_reports_v2 WHERE id=r.id FOR UPDATE NOWAIT;
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER lock_report_entry_shift_recovery BEFORE INSERT OR UPDATE OR DELETE ON public.report_entries
  FOR EACH ROW EXECUTE FUNCTION public.lock_report_entry_shift_recovery();

CREATE FUNCTION public.restore_approved_report_for_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org uuid; r public.daily_reports_v2%ROWTYPE; a hakotora_shift_recovery.approvals%ROWTYPE;
BEGIN
  IF NEW.driver_id IS NULL THEN RETURN NULL; END IF;
  SELECT c.org_id INTO org FROM public.courses c WHERE c.id=NEW.course_id;
  IF org IS NULL THEN RETURN NULL; END IF;
  FOR r IN SELECT * FROM public.daily_reports_v2 d WHERE d.org_id=org AND d.driver_id=NEW.driver_id
    AND d.report_date=NEW.shift_date AND d.course_id=NEW.course_id
    AND d.rejection_reason='shift_changed' AND d.rejected_at IS NOT NULL AND d.approved_at IS NULL
    AND (coalesce(d.cycle_no,0)=coalesce(NEW.cycle_no,0) OR coalesce(d.cycle_no,0)=0)
    ORDER BY d.id FOR UPDATE
  LOOP
    SELECT * INTO a FROM hakotora_shift_recovery.approvals WHERE report_id=r.id FOR UPDATE;
    IF NOT FOUND OR a.rejected_at IS DISTINCT FROM r.rejected_at OR a.restored_at IS NOT NULL OR r.rejected_by IS NOT NULL
      OR a.original_report->>'approved_at' IS NULL
      OR (to_jsonb(r)-ARRAY['approved_at','approved_by','rejected_at','rejected_by','rejection_reason'])
        IS DISTINCT FROM (a.original_report-ARRAY['approved_at','approved_by','rejected_at','rejected_by','rejection_reason'])
      OR a.original_entries IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text),'[]'::jsonb) FROM public.report_entries e WHERE e.report_id=r.id)
    THEN CONTINUE; END IF;
    -- 旧全体日報は解除前の全便が戻るまで復旧しない。
    IF EXISTS(SELECT FROM unnest(a.required_cycles) n WHERE NOT EXISTS(SELECT FROM public.shifts s
      WHERE s.driver_id=r.driver_id AND s.shift_date=r.report_date AND s.course_id=r.course_id
        AND (s.org_id IS NULL OR s.org_id=org) AND coalesce(s.cycle_no,0)=n))
      OR EXISTS(SELECT FROM public.daily_reports_v2 other WHERE other.id<>r.id AND other.org_id=r.org_id
        AND other.driver_id=r.driver_id AND other.report_date=r.report_date AND other.course_id=r.course_id
        AND (coalesce(other.cycle_no,0)=coalesce(r.cycle_no,0) OR coalesce(other.cycle_no,0)=0 OR coalesce(r.cycle_no,0)=0)
        AND (other.rejected_at IS NULL OR other.submitted_at>=r.submitted_at))
    THEN CONTINUE; END IF;
    BEGIN
      -- 元のガードを無効化せず、現在の割当・日報項目を再検証する。
      UPDATE public.daily_reports_v2 SET rejection_reason=NULL WHERE id=r.id;
      UPDATE public.daily_reports_v2 SET approved_at=(a.original_report->>'approved_at')::timestamptz,
        approved_by=(a.original_report->>'approved_by')::uuid,rejected_at=NULL,rejected_by=NULL WHERE id=r.id;
      UPDATE hakotora_shift_recovery.approvals SET restored_at=clock_timestamp() WHERE report_id=r.id;
    EXCEPTION WHEN check_violation THEN
      -- 項目設定が変わっていた場合は対象外のまま残し、シフト保存は妨げない。
      NULL;
    END;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER restore_approved_report_for_shift AFTER INSERT OR UPDATE ON public.shifts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.restore_approved_report_for_shift();
ALTER FUNCTION public.lock_report_entry_shift_recovery() OWNER TO hakotora_shift_report_sync;
ALTER FUNCTION public.restore_approved_report_for_shift() OWNER TO hakotora_shift_report_sync;
REVOKE ALL ON FUNCTION public.lock_report_entry_shift_recovery(),public.restore_approved_report_for_shift()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE CREATE ON SCHEMA public FROM hakotora_shift_report_sync;
GRANT hakotora_shift_report_sync TO CURRENT_USER WITH SET FALSE;
DO $verify$ BEGIN
 IF (SELECT jsonb_build_object(
'reports',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.daily_reports_v2 t),
'shifts',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.shifts t),
'entries',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.report_entries t),
'logs',(select md5(coalesce(string_agg(t.id::text||':'||md5(to_jsonb(t)::text),',' order by t.id),'')) from public.shift_change_logs t))) IS DISTINCT FROM (SELECT fingerprints FROM recovery_migration_fingerprints) THEN RAISE EXCEPTION 'Business data changed during migration'; END IF;
 IF EXISTS(SELECT FROM hakotora_shift_recovery.approvals) THEN RAISE EXCEPTION 'Unexpected historical recovery'; END IF;
END $verify$;
COMMIT;

