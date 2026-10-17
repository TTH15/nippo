-- 便と日報項目の対応を検証して一括保存。過去の明細は書き換えない。
BEGIN;
CREATE FUNCTION public.replace_course_report_fields(p_org uuid, p_course uuid, p_selected jsonb, p_expected jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE carrier uuid; uses_cycles boolean; current_rows jsonb; expected_rows jsonb;
BEGIN
  SELECT c.carrier_id, c.uses_cycles INTO carrier, uses_cycles FROM public.courses c
    WHERE c.id = p_course AND c.org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'コースが見つかりません' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('report-fields:' || p_course::text, 0));
  IF jsonb_typeof(p_selected) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '日報項目の指定が不正です' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.cycle_no, t.unit_id, t.field_key), '[]'::jsonb) INTO current_rows
    FROM (SELECT f.cycle_no, f.unit_id, f.field_key FROM public.course_report_fields f WHERE f.course_id = p_course) t;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.cycle_no, t.unit_id, t.field_key), '[]'::jsonb) INTO expected_rows
    FROM jsonb_to_recordset(p_expected) AS t(cycle_no int, unit_id uuid, field_key text);
  IF current_rows IS DISTINCT FROM expected_rows THEN
    RAISE EXCEPTION '別の担当者が日報項目を変更しました。再読み込みして設定し直してください。' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT FROM jsonb_to_recordset(p_selected) AS s(cycle_no int, unit_id uuid, field_key text)
    WHERE s.cycle_no IS NULL OR s.cycle_no < 0 OR s.unit_id IS NULL OR s.field_key IS NULL
      OR NOT EXISTS (SELECT FROM public.units u JOIN public.unit_fields f ON f.unit_id = u.id
        WHERE u.id = s.unit_id AND u.carrier_id = carrier AND u.active AND f.field_key = s.field_key)
      OR (s.cycle_no <> 0 AND (NOT uses_cycles OR NOT EXISTS (
        SELECT FROM public.course_cycles cc WHERE cc.course_id = p_course AND cc.cycle_no = s.cycle_no AND cc.active)))
  ) OR EXISTS (
    SELECT FROM jsonb_to_recordset(p_selected) AS s(cycle_no int, unit_id uuid, field_key text)
    GROUP BY cycle_no, unit_id, field_key HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'コース・便にない日報項目が含まれています' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.course_report_fields f WHERE f.course_id = p_course;
  INSERT INTO public.course_report_fields(course_id, cycle_no, unit_id, field_key)
    SELECT p_course, s.cycle_no, s.unit_id, s.field_key
    FROM jsonb_to_recordset(p_selected) AS s(cycle_no int, unit_id uuid, field_key text);
END $$;
REVOKE ALL ON FUNCTION public.replace_course_report_fields(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_course_report_fields(uuid,uuid,jsonb,jsonb) TO service_role;

-- 旧画面からの送信や設定保存との競合でも、別便の数量を新しく混ぜない。
CREATE ROLE hakotora_report_field_guard NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO hakotora_report_field_guard;
-- Supabaseの非superuser管理者でも所有者を限定できるよう、DDL中だけSET/CREATEを許可。
GRANT hakotora_report_field_guard TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA public TO hakotora_report_field_guard;
GRANT SELECT(id, course_id, cycle_no) ON public.daily_reports_v2 TO hakotora_report_field_guard;
GRANT SELECT(course_id, cycle_no, unit_id, field_key) ON public.course_report_fields TO hakotora_report_field_guard;
CREATE POLICY report_field_guard_read ON public.daily_reports_v2 FOR SELECT TO hakotora_report_field_guard USING (true);
CREATE POLICY report_field_guard_read ON public.course_report_fields FOR SELECT TO hakotora_report_field_guard USING (true);
CREATE FUNCTION public.guard_report_entry_cycle_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE course uuid; cycle int; configured_cycle int;
BEGIN
  -- 設定変更だけで保存済みの実績を消さない。既存値の維持・ゼロ訂正は許可する。
  IF TG_OP = 'UPDATE' AND (NEW.report_id, NEW.unit_id, NEW.field_key, NEW.value_num, NEW.value_text)
    IS NOT DISTINCT FROM (OLD.report_id, OLD.unit_id, OLD.field_key, OLD.value_num, OLD.value_text) THEN RETURN NEW; END IF;
  IF COALESCE(NEW.value_num, 0) = 0 AND COALESCE(btrim(NEW.value_text), '') IN ('', 'false') THEN RETURN NEW; END IF;
  SELECT r.course_id, COALESCE(r.cycle_no, 0) INTO course, cycle FROM public.daily_reports_v2 r WHERE r.id = NEW.report_id;
  IF course IS NULL THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Report field changes require READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('report-fields:' || course::text, 0)) THEN
    RAISE EXCEPTION '日報項目が変更されています。再読み込みしてください。' USING ERRCODE = '23514', CONSTRAINT = 'report_entry_cycle_fields';
  END IF;
  SELECT f.cycle_no INTO configured_cycle FROM public.course_report_fields f
    WHERE f.course_id = course AND f.cycle_no IN (cycle, 0)
    ORDER BY (f.cycle_no = cycle) DESC LIMIT 1;
  IF configured_cycle IS NOT NULL AND NOT EXISTS (
    SELECT FROM public.course_report_fields f WHERE f.course_id = course AND f.cycle_no = configured_cycle
      AND f.unit_id = NEW.unit_id AND f.field_key = NEW.field_key
  ) THEN RAISE EXCEPTION '便に対応していない日報項目です。日報項目を確認してください。'
    USING ERRCODE = '23514', CONSTRAINT = 'report_entry_cycle_fields'; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.guard_report_entry_cycle_fields() OWNER TO hakotora_report_field_guard;
REVOKE ALL ON FUNCTION public.guard_report_entry_cycle_fields() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_report_entry_cycle_fields BEFORE INSERT OR UPDATE ON public.report_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_entry_cycle_fields();
-- 読取後に対応設定が変更された場合も、確認前の内容をそのまま承認しない。
GRANT SELECT(report_id, unit_id, field_key, value_num, value_text) ON public.report_entries TO hakotora_report_field_guard;
CREATE POLICY report_field_guard_read ON public.report_entries FOR SELECT TO hakotora_report_field_guard USING (true);
CREATE FUNCTION public.guard_report_approval_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE configured_cycle int;
BEGIN
  IF NEW.approved_at IS NULL OR OLD.approved_at IS NOT NULL OR NEW.course_id IS NULL OR NEW.rejected_at IS NOT NULL THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Report field changes require READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('report-fields:' || NEW.course_id::text, 0)) THEN
    RAISE EXCEPTION '日報項目が変更されています。再読み込みして確認してください。' USING ERRCODE = '23514', CONSTRAINT = 'report_approval_cycle_fields';
  END IF;
  SELECT f.cycle_no INTO configured_cycle FROM public.course_report_fields f
    WHERE f.course_id = NEW.course_id AND f.cycle_no IN (COALESCE(NEW.cycle_no, 0), 0)
    ORDER BY (f.cycle_no = COALESCE(NEW.cycle_no, 0)) DESC LIMIT 1;
  IF configured_cycle IS NOT NULL AND EXISTS (
    SELECT FROM public.report_entries e WHERE e.report_id = NEW.id
      AND (COALESCE(e.value_num, 0) <> 0 OR COALESCE(btrim(e.value_text), '') NOT IN ('', 'false'))
      AND NOT EXISTS (SELECT FROM public.course_report_fields f WHERE f.course_id = NEW.course_id
        AND f.cycle_no = configured_cycle AND f.unit_id = e.unit_id AND f.field_key = e.field_key)
  ) THEN RAISE EXCEPTION '便に対応していない日報項目があります。日報を修正してから承認してください。'
    USING ERRCODE = '23514', CONSTRAINT = 'report_approval_cycle_fields'; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.guard_report_approval_fields() OWNER TO hakotora_report_field_guard;
REVOKE ALL ON FUNCTION public.guard_report_approval_fields() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_report_approval_fields BEFORE UPDATE OF approved_at ON public.daily_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_approval_fields();
REVOKE CREATE ON SCHEMA public FROM hakotora_report_field_guard;
GRANT hakotora_report_field_guard TO CURRENT_USER WITH SET FALSE;
COMMIT;
