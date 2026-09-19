-- 個人メモの明示反映。確認は読み取りのみ、確定は差分・ログを1トランザクションで保存。
-- 既存の通常編集も含む同時更新を、短時間のshiftsテーブルロックとrevision照合で検出する。
CREATE OR REPLACE FUNCTION public.reflect_shift_memo(
  p_org_id uuid, p_actor_id uuid, p_groups jsonb, p_mode text, p_revision text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
SET lock_timeout = '5s' SET statement_timeout = '20s'
AS $$
DECLARE
  g jsonb; v_date date; v_course uuid; v_cycle int; v_driver uuid; v_slot int;
  v_start date; v_end date; v_revision text; v_snapshot jsonb;
  v_changes jsonb := '[]'; v_warnings jsonb := '[]'; v_desired uuid[]; v_before uuid[];
  v_add uuid[]; v_remove uuid[]; v_keep uuid[]; v_row public.shifts%ROWTYPE;
  v_added int := 0; v_removed int := 0; v_kept int := 0;
BEGIN
  IF p_org_id IS NULL OR NOT EXISTS (SELECT 1 FROM drivers WHERE id=p_actor_id AND org_id=p_org_id AND status='active') THEN
    RAISE EXCEPTION 'Invalid organization or actor' USING ERRCODE='42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('add','replace') OR jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid input' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_groups) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Invalid group count' USING ERRCODE='22023';
  END IF;
  -- add/replace以外の通常編集もこのロック中は待機する。previewではロック・書き込みをしない。
  IF p_revision IS NOT NULL THEN LOCK TABLE public.shifts IN SHARE ROW EXCLUSIVE MODE; END IF;
  FOR g IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR jsonb_typeof(g->'driverIds') IS DISTINCT FROM 'array'
      OR coalesce(g->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(g->>'cycleNo','') !~ '^\d+$'
      OR g->>'courseId' IS NULL THEN
      RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';
    END IF;
    v_date := (g->>'date')::date; v_course := (g->>'courseId')::uuid; v_cycle := (g->>'cycleNo')::int;
    IF NOT EXISTS (SELECT 1 FROM courses c WHERE c.id=v_course AND c.org_id=p_org_id AND c.archived_at IS NULL
      AND ((NOT coalesce(c.uses_cycles,false) AND v_cycle=0) OR (c.uses_cycles AND EXISTS (
        SELECT 1 FROM course_cycles cc WHERE cc.course_id=c.id AND cc.cycle_no=v_cycle AND cc.active IS DISTINCT FROM false)))) THEN
      RAISE EXCEPTION 'Course or cycle is unavailable' USING ERRCODE='P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(g->'driverIds') x(value) WHERE NOT EXISTS (
      SELECT 1 FROM drivers d WHERE d.id=x.value::uuid AND d.org_id=p_org_id AND d.status='active' AND d.works_as_driver)) THEN
      RAISE EXCEPTION 'Driver is unavailable' USING ERRCODE='P0002';
    END IF;
    IF (SELECT count(*) <> count(DISTINCT value::uuid) FROM jsonb_array_elements_text(g->'driverIds')) THEN
      RAISE EXCEPTION 'Duplicate driver' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_groups) x GROUP BY (x->>'date')::date,(x->>'courseId')::uuid,(x->>'cycleNo')::int HAVING count(*)>1)
    OR (SELECT sum(jsonb_array_length(x->'driverIds')) FROM jsonb_array_elements(p_groups) x)>5000 THEN
    RAISE EXCEPTION 'Duplicate or excessive groups' USING ERRCODE='22023';
  END IF;
  SELECT min((x->>'date')::date),max((x->>'date')::date) INTO v_start,v_end FROM jsonb_array_elements(p_groups) x;
  IF v_end-v_start>61 THEN RAISE EXCEPTION 'Period too long' USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(jsonb_build_object('date',(x->>'date')::date,'courseId',(x->>'courseId')::uuid,'cycleNo',(x->>'cycleNo')::int,
    'driverIds',coalesce((SELECT jsonb_agg(value::uuid ORDER BY value::uuid) FROM jsonb_array_elements_text(x->'driverIds')),'[]'::jsonb))
    ORDER BY x->>'date', (x->>'courseId')::uuid, (x->>'cycleNo')::int) INTO p_groups FROM jsonb_array_elements(p_groups) x;

  -- 名前は自社だけ。既存の壊れた横断参照を表示や更新へ持ち込まない。
  IF EXISTS (SELECT 1 FROM shifts s JOIN courses c ON c.id=s.course_id WHERE c.org_id=p_org_id
    AND s.shift_date BETWEEN v_start AND v_end AND s.driver_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.id=s.driver_id AND d.org_id=p_org_id)) THEN
    RAISE EXCEPTION 'Invalid driver reference' USING ERRCODE='P0002';
  END IF;
  -- scope内の配置・車両・時刻だけでなく、警告の根拠（別コース・希望休）も同じ確認時点に固定。
  SELECT jsonb_build_object(
    'input',p_groups,'mode',p_mode,
    'shifts',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM shifts s JOIN courses c ON c.id=s.course_id
      WHERE c.org_id=p_org_id AND s.shift_date BETWEEN v_start AND v_end),'[]'::jsonb),
    'requests',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM shift_requests r JOIN drivers d ON d.id=r.driver_id
      WHERE d.org_id=p_org_id AND r.request_date BETWEEN v_start AND v_end),'[]'::jsonb),
    'courses',coalesce((SELECT jsonb_agg(jsonb_build_array(c.id,c.uses_cycles,c.archived_at) ORDER BY c.id) FROM courses c WHERE c.org_id=p_org_id),'[]'::jsonb)
  ) INTO v_snapshot;
  v_revision := md5(v_snapshot::text);
  IF p_revision IS NOT NULL AND p_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'Shifts changed since preview' USING ERRCODE='40001';
  END IF;

  FOR g IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    v_date := (g->>'date')::date; v_course := (g->>'courseId')::uuid; v_cycle := (g->>'cycleNo')::int;
    SELECT coalesce(array_agg(value::uuid ORDER BY value),'{}'::uuid[]) INTO v_desired FROM jsonb_array_elements_text(g->'driverIds');
    SELECT coalesce(array_agg(DISTINCT driver_id ORDER BY driver_id),'{}'::uuid[]) INTO v_before
      FROM shifts WHERE shift_date=v_date AND course_id=v_course AND cycle_no=v_cycle AND driver_id IS NOT NULL;
    -- 不正な既存重複は自動修復せず停止する（差分の件数と変更される行を一致させる）。
    IF (SELECT count(*) FROM shifts WHERE shift_date=v_date AND course_id=v_course AND cycle_no=v_cycle AND driver_id IS NOT NULL) <> cardinality(v_before) THEN
      RAISE EXCEPTION 'Duplicate existing assignments' USING ERRCODE='22023';
    END IF;
    SELECT coalesce(array_agg(x),'{}'::uuid[]) INTO v_add FROM unnest(v_desired) x WHERE NOT x=ANY(v_before);
    SELECT coalesce(array_agg(x),'{}'::uuid[]) INTO v_remove FROM unnest(v_before) x WHERE p_mode='replace' AND NOT x=ANY(v_desired);
    SELECT coalesce(array_agg(x),'{}'::uuid[]) INTO v_keep FROM unnest(v_before) x WHERE NOT x=ANY(v_remove);
    v_added := v_added+cardinality(v_add); v_removed := v_removed+cardinality(v_remove); v_kept := v_kept+cardinality(v_keep);
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('date',v_date,'courseId',v_course,'cycleNo',v_cycle,
      'addIds',to_jsonb(v_add),'removeIds',to_jsonb(v_remove),'keepIds',to_jsonb(v_keep)));
  END LOOP;

  -- 反映後にも残る別コースの配置と、全休/該当便の希望休を表示する。C1/C2の兼務は重複扱いにしない。
  SELECT coalesce(jsonb_agg(DISTINCT warning),'[]'::jsonb) INTO v_warnings FROM (
    SELECT jsonb_build_object('date',s.shift_date,'driverId',s.driver_id,'courseName',c.name,'kind','other-course') warning
    FROM jsonb_array_elements(p_groups) target CROSS JOIN LATERAL jsonb_array_elements_text(target->'driverIds') d
    JOIN shifts s ON s.driver_id=d.value::uuid AND s.shift_date=(target->>'date')::date AND s.course_id<>(target->>'courseId')::uuid
    JOIN courses c ON c.id=s.course_id AND c.org_id=p_org_id
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_changes) ch WHERE ch->>'date'=s.shift_date::text
      AND ch->>'courseId'=s.course_id::text AND (ch->>'cycleNo')::int=s.cycle_no AND ch->'removeIds' ? s.driver_id::text)
    UNION
    SELECT jsonb_build_object('date',target->>'date','driverId',d.value,'courseName',c2.name,'kind','other-course')
    FROM jsonb_array_elements(p_groups) target CROSS JOIN LATERAL jsonb_array_elements_text(target->'driverIds') d
    JOIN jsonb_array_elements(p_groups) g2 ON g2->>'date'=target->>'date' AND g2->>'courseId'<>target->>'courseId' AND g2->'driverIds' ? d.value
    JOIN courses c2 ON c2.id=(g2->>'courseId')::uuid AND c2.org_id=p_org_id
    UNION
    SELECT jsonb_build_object('date',r.request_date,'driverId',r.driver_id,'courseName',c.name,'kind','off')
    FROM jsonb_array_elements(p_groups) target CROSS JOIN LATERAL jsonb_array_elements_text(target->'driverIds') d
    JOIN courses c ON c.id=(target->>'courseId')::uuid AND c.org_id=p_org_id
    JOIN shift_requests r ON r.driver_id=d.value::uuid AND r.request_date=(target->>'date')::date
      AND (r.slot_id IS NULL OR r.slot_id=c.slot_id)
  ) warnings;

  IF p_revision IS NOT NULL THEN
    FOR g IN SELECT value FROM jsonb_array_elements(v_changes) LOOP
      v_date := (g->>'date')::date; v_course := (g->>'courseId')::uuid; v_cycle := (g->>'cycleNo')::int;
      FOR v_row IN SELECT * FROM shifts WHERE shift_date=v_date AND course_id=v_course AND cycle_no=v_cycle AND g->'removeIds' ? driver_id::text LOOP
        INSERT INTO shift_change_logs(org_id,actor_driver_id,action,shift_date,course_id,cycle_no,slot,before,after)
          VALUES(p_org_id,p_actor_id,'clear_driver',v_date,v_course,v_cycle,v_row.slot,to_jsonb(v_row),jsonb_build_object('driverId',NULL,'source','shift_memo'));
        UPDATE shifts SET driver_id=NULL,vehicle_id=NULL,uses_external_vehicle=false,
          meeting_place=NULL,meeting_time=NULL,arrival_time=NULL,end_time=NULL,import_batch_id=NULL,updated_at=now() WHERE id=v_row.id;
      END LOOP;
      FOR v_driver IN SELECT value::uuid FROM jsonb_array_elements_text(g->'addIds') LOOP
        -- 車両・個別時刻・取込元のない空枠だけを再利用する。既存の配車だけの行は保持。
        SELECT min(slot) INTO v_slot FROM shifts WHERE shift_date=v_date AND course_id=v_course AND cycle_no=v_cycle
          AND driver_id IS NULL AND vehicle_id IS NULL AND NOT coalesce(uses_external_vehicle,false)
          AND meeting_place IS NULL AND meeting_time IS NULL AND arrival_time IS NULL AND end_time IS NULL AND import_batch_id IS NULL;
        IF v_slot IS NULL THEN
          SELECT min(n) INTO v_slot FROM generate_series(1,coalesce((SELECT max(slot) FROM shifts WHERE shift_date=v_date AND course_id=v_course AND cycle_no=v_cycle),0)+1) n
            WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE shift_date=v_date AND course_id=v_course AND cycle_no=v_cycle AND slot=n);
          INSERT INTO shifts(shift_date,course_id,cycle_no,slot,driver_id) VALUES(v_date,v_course,v_cycle,v_slot,v_driver);
        ELSE
          UPDATE shifts SET driver_id=v_driver,updated_at=now() WHERE shift_date=v_date AND course_id=v_course AND cycle_no=v_cycle AND slot=v_slot;
        END IF;
        INSERT INTO shift_change_logs(org_id,actor_driver_id,action,shift_date,course_id,cycle_no,slot,before,after)
          VALUES(p_org_id,p_actor_id,'assign_driver',v_date,v_course,v_cycle,v_slot,jsonb_build_object('driverId',NULL),jsonb_build_object('driverId',v_driver,'source','shift_memo'));
      END LOOP;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('revision',v_revision,'changes',v_changes,'warnings',v_warnings,
    'added',v_added,'removed',v_removed,'kept',v_kept,'applied',p_revision IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.reflect_shift_memo(uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reflect_shift_memo(uuid,uuid,jsonb,text,text) TO service_role;
