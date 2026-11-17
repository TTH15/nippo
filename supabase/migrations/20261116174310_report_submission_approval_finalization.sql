-- 送信・追加承認・確定は各RPCの単一トランザクション。既存の提出/項目ガードは維持する。
BEGIN;
ALTER TABLE public.daily_reports_v2 ADD COLUMN finalized_at timestamptz,
  ADD COLUMN finalized_shift_snapshot jsonb,
  ADD COLUMN finalization_required boolean NOT NULL DEFAULT true;
ALTER TABLE public.shift_correction_sessions ADD COLUMN original_state jsonb;
ALTER TABLE public.report_course_requests ADD COLUMN approved_report_id uuid REFERENCES public.daily_reports_v2(id);
CREATE TABLE public.report_submission_receipts (
  org_id uuid NOT NULL REFERENCES public.organizations(id), driver_id uuid NOT NULL REFERENCES public.drivers(id),
  client_key text NOT NULL CHECK(length(client_key) BETWEEN 1 AND 100), payload jsonb NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,driver_id,client_key)
);
ALTER TABLE public.report_submission_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_submission_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.report_submission_receipts TO service_role;

CREATE FUNCTION public.report_day_revision(p_org uuid,p_driver uuid,p_date date) RETURNS text
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT md5(jsonb_build_object(
 'reports',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=p_driver AND r.report_date=p_date),
 'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text),'[]') FROM public.report_entries e JOIN public.daily_reports_v2 r ON r.id=e.report_id WHERE r.org_id=p_org AND r.driver_id=p_driver AND r.report_date=p_date),
 'requests',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') FROM public.report_course_requests q WHERE q.org_id=p_org AND q.driver_id=p_driver AND q.report_date=p_date),
 'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.shifts s JOIN public.courses c ON c.id=s.course_id WHERE c.org_id=p_org AND s.driver_id=p_driver AND s.shift_date=p_date))::text)
$$;
REVOKE ALL ON FUNCTION public.report_day_revision(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.report_day_revision(uuid,uuid,date) TO service_role;

-- 設定の変更は共有行ロック/項目用advisory lockと直列化する。
CREATE FUNCTION public.validate_report_item(p_org uuid,p_driver uuid,p_date date,p_item jsonb,p_identity uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c public.courses%ROWTYPE; cyc int; e jsonb; configured int;
BEGIN
 SELECT * INTO c FROM public.courses WHERE id=(p_item->>'courseId')::uuid AND org_id=p_org AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'コースが見つかりません' USING ERRCODE='23514'; END IF;
 cyc:=coalesce((p_item->>'cycleNo')::int,0);
 IF cyc<0 OR (NOT coalesce(c.uses_cycles,false) AND cyc<>0) OR
   (c.uses_cycles AND cyc>0 AND NOT EXISTS(SELECT FROM public.course_cycles WHERE course_id=c.id AND cycle_no=cyc AND active IS DISTINCT FROM false FOR SHARE)) THEN
   RAISE EXCEPTION '便の設定が変更されています' USING ERRCODE='23514'; END IF;
 IF p_identity IS NOT NULL AND NOT EXISTS(SELECT FROM public.driver_identities WHERE id=p_identity AND driver_id=p_driver) THEN
   RAISE EXCEPTION '勤務区分を確認してください' USING ERRCODE='23514'; END IF;
 IF p_item->>'vehicleId' IS NOT NULL AND NOT EXISTS(SELECT FROM public.vehicles v WHERE v.id=(p_item->>'vehicleId')::uuid
   AND (v.owner_org_id=p_org OR EXISTS(SELECT FROM public.vehicle_loans l WHERE l.vehicle_id=v.id AND l.borrower_org_id=p_org AND l.loan_date=p_date))) THEN
   RAISE EXCEPTION '車両が見つかりません' USING ERRCODE='23514'; END IF;
 IF p_item->>'meterValue' IS NOT NULL AND ((p_item->>'meterValue')::numeric<0 OR (p_item->>'meterValue')::numeric<>trunc((p_item->>'meterValue')::numeric)) THEN
   RAISE EXCEPTION '走行距離を確認してください' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_item->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(p_item->'entries')>200 THEN
   RAISE EXCEPTION '日報項目を確認してください' USING ERRCODE='22023'; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('report-fields:'||c.id::text,0)) THEN RAISE EXCEPTION '日報項目が変更されています' USING ERRCODE='40001'; END IF;
 SELECT f.cycle_no INTO configured FROM public.course_report_fields f WHERE f.course_id=c.id AND f.cycle_no IN(cyc,0) ORDER BY (f.cycle_no=cyc) DESC LIMIT 1;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_item->'entries') x GROUP BY x->>'unitId',x->>'fieldKey' HAVING count(*)>1) THEN
   RAISE EXCEPTION '日報項目が重複しています' USING ERRCODE='22023'; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(p_item->'entries') LOOP
   IF NOT EXISTS(SELECT FROM public.units u JOIN public.unit_fields f ON f.unit_id=u.id WHERE u.id=(e->>'unitId')::uuid AND u.carrier_id=c.carrier_id AND u.active AND f.field_key=e->>'fieldKey') THEN
     RAISE EXCEPTION '日報項目が変更されています' USING ERRCODE='23514'; END IF;
   IF configured IS NOT NULL AND (coalesce((e->>'valueNum')::numeric,0)<>0 OR coalesce(btrim(e->>'valueText'),'') NOT IN('','false')) AND NOT EXISTS(
     SELECT FROM public.course_report_fields f WHERE f.course_id=c.id AND f.cycle_no=configured AND f.unit_id=(e->>'unitId')::uuid AND f.field_key=e->>'fieldKey') THEN
     RAISE EXCEPTION '便に対応していない日報項目です' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.validate_report_item(uuid,uuid,date,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_report_item(uuid,uuid,date,jsonb,uuid) TO service_role;

CREATE FUNCTION public.submit_report_day(p_org uuid,p_driver uuid,p_date date,p_identity uuid,p_items jsonb,p_expected text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' SET statement_timeout='20s' AS $$
DECLARE item jsonb; r public.daily_reports_v2%ROWTYPE; rid uuid; request_id uuid; ids uuid[]:='{}'; requests uuid[]:='{}';
  payload jsonb; receipt public.report_submission_receipts%ROWTYPE; entry_values jsonb; old_values jsonb; is_request boolean; expected_requests uuid[]:='{}';
BEGIN
 IF NOT EXISTS(SELECT FROM public.drivers WHERE id=p_driver AND org_id=p_org AND status='active' AND works_as_driver) THEN RAISE EXCEPTION 'ドライバーが見つかりません' USING ERRCODE='P0002'; END IF;
 IF p_date IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '日報を確認してください' USING ERRCODE='22023'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text||':'||p_driver::text||':'||p_date::text||':correction',0)) THEN RAISE EXCEPTION '日報が変更されています' USING ERRCODE='40001'; END IF;
 payload:=jsonb_build_object('date',p_date,'identity',p_identity,'items',p_items);
 SELECT * INTO receipt FROM public.report_submission_receipts WHERE org_id=p_org AND driver_id=p_driver AND client_key=p_key;
 IF FOUND THEN
   IF receipt.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION '送信内容が変更されています。画面を開き直してください' USING ERRCODE='40001'; END IF;
   RETURN receipt.result;
 END IF;
 IF p_expected IS NULL OR p_expected IS DISTINCT FROM public.report_day_revision(p_org,p_driver,p_date) THEN RAISE EXCEPTION '日報またはシフトが変更されています。再読み込みしてください' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_items) x GROUP BY x->>'courseId',coalesce(x->>'cycleNo','0') HAVING count(*)>1) THEN RAISE EXCEPTION 'コース・便が重複しています' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_items) ORDER BY value->>'courseId',value->>'cycleNo' LOOP
   PERFORM public.validate_report_item(p_org,p_driver,p_date,item,p_identity);
   is_request:=coalesce((item->>'request')::boolean,false);
   IF is_request THEN
     IF coalesce((item->>'cycleNo')::int,0)=0 AND EXISTS(SELECT FROM public.courses WHERE id=(item->>'courseId')::uuid AND uses_cycles) THEN RAISE EXCEPTION '便を選択してください' USING ERRCODE='23514'; END IF;
     request_id:=public.save_report_course_request(p_org,p_driver,p_date,(item->>'courseId')::uuid,coalesce((item->>'cycleNo')::int,0),
       jsonb_build_object('identityId',p_identity,'vehicleId',item->'vehicleId','meterValue',item->'meterValue','entries',item->'entries'));
     requests:=array_append(requests,request_id);
   ELSE
     SELECT * INTO r FROM public.daily_reports_v2 WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND course_id=(item->>'courseId')::uuid AND coalesce(cycle_no,0)=coalesce((item->>'cycleNo')::int,0) AND rejected_at IS NULL FOR UPDATE;
     IF NOT EXISTS(SELECT FROM public.shifts s WHERE s.driver_id=p_driver AND s.shift_date=p_date AND s.course_id=(item->>'courseId')::uuid AND (coalesce(s.cycle_no,0)=coalesce((item->>'cycleNo')::int,0) OR (r.id IS NOT NULL AND coalesce(r.cycle_no,0)=0))) THEN RAISE EXCEPTION 'シフトが変更されています' USING ERRCODE='23514'; END IF;
     SELECT coalesce(jsonb_agg(jsonb_build_object('unitId',e->>'unitId','fieldKey',e->>'fieldKey','valueNum',e->'valueNum','valueText',e->'valueText') ORDER BY e->>'unitId',e->>'fieldKey'),'[]') INTO entry_values FROM jsonb_array_elements(item->'entries') e;
     SELECT coalesce(jsonb_agg(jsonb_build_object('unitId',unit_id,'fieldKey',field_key,'valueNum',value_num,'valueText',value_text) ORDER BY unit_id,field_key),'[]') INTO old_values FROM public.report_entries WHERE report_id=r.id;
     IF r.id IS NOT NULL AND r.approved_at IS NOT NULL AND r.vehicle_id IS NOT DISTINCT FROM (item->>'vehicleId')::uuid AND r.meter_value IS NOT DISTINCT FROM (item->>'meterValue')::int AND old_values=entry_values THEN
       ids:=array_append(ids,r.id); CONTINUE;
     END IF;
     IF r.id IS NULL THEN
       INSERT INTO public.daily_reports_v2(org_id,driver_id,report_date,course_id,cycle_no,carrier_id,identity_id,vehicle_id,meter_value,submitted_at)
       SELECT p_org,p_driver,p_date,c.id,coalesce((item->>'cycleNo')::int,0),c.carrier_id,p_identity,(item->>'vehicleId')::uuid,(item->>'meterValue')::int,clock_timestamp() FROM public.courses c WHERE c.id=(item->>'courseId')::uuid RETURNING id INTO rid;
     ELSE
       rid:=r.id;
       UPDATE public.daily_reports_v2 SET identity_id=p_identity,vehicle_id=(item->>'vehicleId')::uuid,meter_value=(item->>'meterValue')::int,
         submitted_at=clock_timestamp(),approved_at=NULL,approved_by=NULL,rate_snapshot=NULL,finalized_at=NULL,finalized_shift_snapshot=NULL WHERE id=rid;
     END IF;
     DELETE FROM public.report_entries WHERE report_id=rid;
     INSERT INTO public.report_entries(org_id,report_id,unit_id,field_key,value_num,value_text)
       SELECT p_org,rid,(e->>'unitId')::uuid,e->>'fieldKey',(e->>'valueNum')::numeric,e->>'valueText' FROM jsonb_array_elements(item->'entries') e;
     ids:=array_append(ids,rid);
   END IF;
 END LOOP;
 -- フォームから外した承認待ち申請は同じ送信で取り消す。
 UPDATE public.report_course_requests SET status='cancelled',decided_at=clock_timestamp(),decided_by=p_driver
 WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND status='pending' AND NOT(id=ANY(requests));
 payload:=jsonb_build_object('reportIds',ids,'requestIds',requests);
 INSERT INTO public.report_submission_receipts(org_id,driver_id,client_key,payload,result) VALUES(p_org,p_driver,p_key,jsonb_build_object('date',p_date,'identity',p_identity,'items',p_items),payload);
 RETURN payload;
END $$;
REVOKE ALL ON FUNCTION public.submit_report_day(uuid,uuid,date,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_report_day(uuid,uuid,date,uuid,jsonb,text,text) TO service_role;

CREATE FUNCTION public.decide_report_day(p_org uuid,p_actor uuid,p_driver uuid,p_date date,p_approve boolean,p_expected text DEFAULT NULL,p_requests uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' SET statement_timeout='20s' AS $$
DECLARE q public.report_course_requests%ROWTYPE; r public.daily_reports_v2%ROWTYPE; item jsonb; rid uuid; target_slot int; ids uuid[]:='{}'; pending_ids uuid[]; meter_row record; affected int:=0;
BEGIN
 IF NOT EXISTS(SELECT FROM public.drivers WHERE id=p_actor AND org_id=p_org AND status='active') OR NOT EXISTS(SELECT FROM public.drivers WHERE id=p_driver AND org_id=p_org) THEN RAISE EXCEPTION '対象が見つかりません' USING ERRCODE='P0002'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text||':'||p_driver::text||':'||p_date::text||':correction',0)) THEN RAISE EXCEPTION '日報が変更されています' USING ERRCODE='40001'; END IF;
 IF p_expected IS NOT NULL AND p_expected IS DISTINCT FROM public.report_day_revision(p_org,p_driver,p_date) THEN RAISE EXCEPTION '日報が変更されています。再読み込みしてください' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO pending_ids FROM public.report_course_requests WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND status='pending';
 IF cardinality(pending_ids)>0 AND (p_expected IS NULL OR pending_ids IS DISTINCT FROM ARRAY(SELECT x FROM unnest(p_requests) x ORDER BY x)) THEN RAISE EXCEPTION '追加申請の内容を確認してから承認・却下してください' USING ERRCODE='40001'; END IF;
 IF NOT p_approve THEN
   UPDATE public.daily_reports_v2 SET approved_at=NULL,approved_by=NULL,rejected_at=clock_timestamp(),rejected_by=p_actor,rejection_reason=NULL,rate_snapshot=NULL
     WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND rejected_at IS NULL;
   GET DIAGNOSTICS affected=ROW_COUNT;
   UPDATE public.report_course_requests SET status='rejected',decided_at=clock_timestamp(),decided_by=p_actor WHERE id=ANY(pending_ids);
   IF affected=0 AND cardinality(pending_ids)=0 THEN RAISE EXCEPTION '日報が見つかりません' USING ERRCODE='P0002'; END IF;
   RETURN jsonb_build_object('ok',true,'warnings','[]'::jsonb);
 END IF;
 FOR q IN SELECT * FROM public.report_course_requests WHERE id=ANY(pending_ids) ORDER BY course_id,cycle_no FOR UPDATE LOOP
   item:=q.payload||jsonb_build_object('courseId',q.course_id,'cycleNo',q.cycle_no);
   PERFORM public.validate_report_item(p_org,p_driver,p_date,item,(q.payload->>'identityId')::uuid);
   IF EXISTS(SELECT FROM public.courses WHERE id=q.course_id AND uses_cycles AND q.cycle_no=0) THEN RAISE EXCEPTION '便の設定が変更されています' USING ERRCODE='23514'; END IF;
   -- 同じコース・日付の枠追加を直列化。通常割当とは一意制約で最後に照合する。
   IF NOT pg_try_advisory_xact_lock(hashtextextended('request-slot:'||q.course_id::text||':'||p_date::text||':'||q.cycle_no::text,0)) THEN RAISE EXCEPTION 'シフトが変更されています' USING ERRCODE='40001'; END IF;
   IF NOT EXISTS(SELECT FROM public.shifts WHERE driver_id=p_driver AND shift_date=p_date AND course_id=q.course_id AND coalesce(cycle_no,0)=q.cycle_no) THEN
     SELECT s.slot INTO target_slot FROM public.shifts s WHERE s.course_id=q.course_id AND s.shift_date=p_date AND s.cycle_no=q.cycle_no
       AND s.driver_id IS NULL AND s.vehicle_id IS NULL AND NOT coalesce(s.uses_external_vehicle,false)
       AND s.meeting_place IS NULL AND s.meeting_time IS NULL AND s.arrival_time IS NULL AND s.end_time IS NULL AND s.import_batch_id IS NULL ORDER BY slot LIMIT 1 FOR UPDATE;
     IF target_slot IS NULL THEN SELECT coalesce(max(slot),0)+1 INTO target_slot FROM public.shifts WHERE course_id=q.course_id AND shift_date=p_date AND cycle_no=q.cycle_no; END IF;
     PERFORM set_config('hakotora.approving_request',q.id::text,true);
     PERFORM public.assign_shift_driver(p_org,p_actor,p_date,q.course_id,q.cycle_no,target_slot,p_driver,NULL,true);
     PERFORM set_config('hakotora.approving_request','',true);
   END IF;
   IF EXISTS(SELECT FROM public.daily_reports_v2 WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND course_id=q.course_id AND rejected_at IS NULL AND (coalesce(cycle_no,0)=q.cycle_no OR coalesce(cycle_no,0)=0)) THEN RAISE EXCEPTION '同じコース・便の日報が提出されています。追加申請を取り消して確認してください' USING ERRCODE='40001'; END IF;
   INSERT INTO public.daily_reports_v2(org_id,driver_id,report_date,course_id,cycle_no,carrier_id,identity_id,vehicle_id,meter_value,submitted_at)
     SELECT p_org,p_driver,p_date,q.course_id,q.cycle_no,c.carrier_id,(q.payload->>'identityId')::uuid,(q.payload->>'vehicleId')::uuid,(q.payload->>'meterValue')::int,q.submitted_at FROM public.courses c WHERE c.id=q.course_id RETURNING id INTO rid;
   INSERT INTO public.report_entries(org_id,report_id,unit_id,field_key,value_num,value_text)
     SELECT p_org,rid,(e->>'unitId')::uuid,e->>'fieldKey',(e->>'valueNum')::numeric,e->>'valueText' FROM jsonb_array_elements(q.payload->'entries') e;
   UPDATE public.report_course_requests SET status='approved',decided_at=clock_timestamp(),decided_by=p_actor,approved_report_id=rid WHERE id=q.id;
 END LOOP;
 FOR r IN SELECT * FROM public.daily_reports_v2 WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND rejected_at IS NULL AND approved_at IS NULL ORDER BY id FOR UPDATE LOOP
   -- 項目ガードに加え、車両が現在も自社または当日の貸与車であることを確認する。
   IF r.vehicle_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.vehicles v WHERE v.id=r.vehicle_id AND (v.owner_org_id=p_org OR EXISTS(SELECT FROM public.vehicle_loans l WHERE l.vehicle_id=v.id AND l.borrower_org_id=p_org AND l.loan_date=p_date))) THEN RAISE EXCEPTION '車両が見つかりません' USING ERRCODE='23514'; END IF;
   UPDATE public.daily_reports_v2 SET approved_at=clock_timestamp(),approved_by=p_actor,rejected_by=NULL,rate_snapshot=NULL,finalization_required=true WHERE id=r.id;
   ids:=array_append(ids,r.id);
 END LOOP;
 IF cardinality(ids)=0 THEN RAISE EXCEPTION '承認待ちの日報がありません' USING ERRCODE='P0002'; END IF;
 FOR meter_row IN SELECT vehicle_id,max(meter_value) meter FROM public.daily_reports_v2 WHERE id=ANY(ids) AND vehicle_id IS NOT NULL AND meter_value IS NOT NULL GROUP BY vehicle_id ORDER BY vehicle_id LOOP
   UPDATE public.vehicles SET current_mileage=greatest(coalesce(current_mileage,0),meter_row.meter),updated_at=clock_timestamp() WHERE id=meter_row.vehicle_id;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'warnings','[]'::jsonb,'reportIds',ids);
END $$;
REVOKE ALL ON FUNCTION public.decide_report_day(uuid,uuid,uuid,date,boolean,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decide_report_day(uuid,uuid,uuid,date,boolean,text,uuid[]) TO service_role;

-- 現在の単価・数量・割当を同じ形式で取り直し、計算中の変更を検出する。
CREATE FUNCTION public.report_finalization_source(p_org uuid,p_driver uuid,p_date date) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 WITH reports AS (SELECT * FROM public.daily_reports_v2 WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND approved_at IS NOT NULL AND rejected_at IS NULL AND finalized_at IS NULL AND finalization_required),
 courses AS (SELECT c.* FROM public.courses c WHERE c.org_id=p_org AND c.id IN(SELECT course_id FROM reports)),
 entries AS (SELECT e.* FROM public.report_entries e WHERE report_id IN(SELECT id FROM reports))
 SELECT jsonb_build_object(
 'reports',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM reports r),'[]'),
 'courses',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM courses c),'[]'),
 'unitRates',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.course_unit_rates t WHERE course_id IN(SELECT id FROM courses)),'[]'),
 'fixedRates',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.course_fixed_rates t WHERE course_id IN(SELECT id FROM courses)),'[]'),
 'fixedBundles',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.course_fixed_rate_bundles t WHERE course_id IN(SELECT id FROM courses)),'[]'),
 'versions',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.course_rate_versions t WHERE org_id=p_org AND course_id IN(SELECT id FROM courses)),'[]'),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text) FROM entries e),'[]'),
 'fields',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.unit_fields t WHERE unit_id IN(SELECT unit_id FROM entries)),'[]'),
 'shifts',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.shifts t WHERE driver_id=p_driver AND shift_date=p_date AND course_id IN(SELECT id FROM courses)),'[]'))
$$;
REVOKE ALL ON FUNCTION public.report_finalization_source(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.report_finalization_source(uuid,uuid,date) TO service_role;

CREATE FUNCTION public.report_finalization_cutoff(p_now timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT ((p_now AT TIME ZONE 'Asia/Tokyo')-interval '3 hours')::date $$;
REVOKE ALL ON FUNCTION public.report_finalization_cutoff(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.report_finalization_cutoff(timestamptz) TO service_role;

CREATE FUNCTION public.finalize_report_day(p_org uuid,p_driver uuid,p_date date,p_expected jsonb,p_snapshots jsonb)
RETURNS int LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE source jsonb; r record; changed int:=0;
BEGIN
 IF p_date>=public.report_finalization_cutoff(clock_timestamp()) THEN RETURN 0; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text||':'||p_driver::text||':'||p_date::text||':correction',0)) THEN RAISE EXCEPTION '日報が変更されています' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT FROM public.shift_correction_sessions WHERE org_id=p_org AND driver_id=p_driver AND shift_date=p_date AND closed_at IS NULL) THEN RETURN 0; END IF;
 -- 単価書込が計算済みソースと照合した直後に割り込むことを防ぐ。短い確定処理だけで保持。
 LOCK TABLE public.courses,public.course_unit_rates,public.course_fixed_rates,public.course_fixed_rate_bundles,public.course_rate_versions,public.unit_fields IN SHARE MODE;
 source:=public.report_finalization_source(p_org,p_driver,p_date);
 IF source IS DISTINCT FROM p_expected THEN RAISE EXCEPTION '単価または日報が変更されています' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_snapshots) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '単価を確認してください' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT * FROM public.daily_reports_v2 WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND approved_at IS NOT NULL AND rejected_at IS NULL AND finalized_at IS NULL AND finalization_required ORDER BY id FOR UPDATE LOOP
   IF p_snapshots->r.id::text IS NULL OR p_snapshots->r.id::text->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(p_snapshots->r.id::text->'components') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '単価を確認してください' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT FROM public.shifts s WHERE driver_id=p_driver AND shift_date=p_date AND course_id=r.course_id AND (coalesce(s.cycle_no,0)=coalesce(r.cycle_no,0) OR coalesce(r.cycle_no,0)=0)) THEN RAISE EXCEPTION 'シフトが変更されています' USING ERRCODE='23514'; END IF;
   UPDATE public.daily_reports_v2 SET rate_snapshot=p_snapshots->r.id::text,finalized_at=clock_timestamp(),finalized_shift_snapshot=source->'shifts' WHERE id=r.id;
   changed:=changed+1;
 END LOOP;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.finalize_report_day(uuid,uuid,date,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_report_day(uuid,uuid,date,jsonb,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.guard_finalized_shift() RETURNS trigger
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
    IF locked AND (TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.driver_id IS NULL)) AND EXISTS(
      SELECT FROM public.report_course_requests q WHERE q.id::text=nullif(current_setting('hakotora.approving_request',true),'')
        AND q.status='pending' AND q.org_id=v_org AND q.driver_id=item.driver_id AND q.report_date=item.shift_date
        AND q.course_id=item.course_id AND q.cycle_no=coalesce(NEW.cycle_no,0)) THEN CONTINUE; END IF;
    IF locked AND NOT EXISTS (SELECT 1 FROM public.shift_correction_sessions s WHERE s.org_id=v_org
      AND s.driver_id=item.driver_id AND s.shift_date=item.shift_date AND s.closed_at IS NULL) THEN
      RAISE EXCEPTION '過去のシフトです。管理者が修正を開始してください' USING ERRCODE='23514', CONSTRAINT='finalized_shift';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_finalized_report() RETURNS trigger
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
  IF TG_OP <> 'INSERT' AND OLD.finalized_at IS NOT NULL AND (TG_OP = 'DELETE' OR to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW))
    AND NOT EXISTS (SELECT 1 FROM public.shift_correction_sessions s WHERE s.org_id=OLD.org_id
      AND s.driver_id=OLD.driver_id AND s.shift_date=OLD.report_date AND s.closed_at IS NULL) THEN
    RAISE EXCEPTION '確定済みの日報です。確定を解除してから修正してください' USING ERRCODE='23514', CONSTRAINT='finalized_report';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_finalized_report_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE report record;
BEGIN
  FOR report IN SELECT r.id,r.org_id,r.driver_id,r.report_date,r.approved_at,r.finalized_at FROM public.daily_reports_v2 r
    WHERE r.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.report_id END,
                   CASE WHEN TG_OP <> 'DELETE' THEN NEW.report_id END) ORDER BY r.id FOR UPDATE
  LOOP
    IF report.org_id IS NOT NULL AND report.driver_id IS NOT NULL AND report.report_date IS NOT NULL
      AND NOT pg_try_advisory_xact_lock(hashtextextended(report.org_id::text || ':' || report.driver_id::text || ':' || report.report_date::text || ':correction',0)) THEN
      RAISE EXCEPTION '日報を確認し直してください' USING ERRCODE='40001';
    END IF;
    IF report.finalized_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shift_correction_sessions s
      WHERE s.org_id=report.org_id AND s.driver_id=report.driver_id AND s.shift_date=report.report_date AND s.closed_at IS NULL) THEN
      RAISE EXCEPTION '確定済みの日報です。確定を解除してから修正してください' USING ERRCODE='23514', CONSTRAINT='finalized_report_entry';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.begin_shift_correction(p_org uuid, p_actor uuid, p_driver uuid, p_date date, p_reason text)
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
  -- 金額・数量・割当の修正前を非公開の監査記録へ残す。
  UPDATE public.shift_correction_sessions SET original_state=jsonb_build_object(
    'reports',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=p_driver AND r.report_date=p_date),
    'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text),'[]') FROM public.report_entries e JOIN public.daily_reports_v2 r ON r.id=e.report_id WHERE r.org_id=p_org AND r.driver_id=p_driver AND r.report_date=p_date),
    'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.shifts t JOIN public.courses c ON c.id=t.course_id WHERE c.org_id=p_org AND t.driver_id=p_driver AND t.shift_date=p_date)) WHERE id=session_id;
  -- 修正開始時に承認と実際の確定を解除。数量は保持し、日報の再承認を必須にする。
  UPDATE public.daily_reports_v2 SET approved_at=NULL,approved_by=NULL,rate_snapshot=NULL,finalized_at=NULL,finalized_shift_snapshot=NULL,finalization_required=true
    WHERE org_id=p_org AND driver_id=p_driver AND report_date=p_date AND approved_at IS NOT NULL AND rejected_at IS NULL;
  RETURN session_id;
END $$;

CREATE OR REPLACE FUNCTION public.finish_shift_correction(p_org uuid, p_actor uuid, p_session uuid)
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
    OR (cardinality(correction.original_approved_reports) > 0 AND EXISTS (SELECT FROM public.shifts WHERE driver_id=correction.driver_id AND shift_date=correction.shift_date) AND NOT EXISTS (
      SELECT 1 FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=correction.driver_id
        AND r.report_date=correction.shift_date AND r.approved_at IS NOT NULL AND r.rejected_at IS NULL)) THEN
    RAISE EXCEPTION '修正前の日報を確認してください' USING ERRCODE='23514', CONSTRAINT='correction_missing_original';
  END IF;
  IF EXISTS(SELECT FROM public.shifts s JOIN public.courses c ON c.id=s.course_id
    WHERE c.org_id=p_org AND s.driver_id=correction.driver_id AND s.shift_date=correction.shift_date AND NOT EXISTS(
      SELECT FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=s.driver_id AND r.report_date=s.shift_date AND r.course_id=s.course_id
       AND r.approved_at IS NOT NULL AND r.rejected_at IS NULL AND (coalesce(r.cycle_no,0)=coalesce(s.cycle_no,0) OR (coalesce(r.cycle_no,0)=0 AND NOT EXISTS(
        SELECT FROM public.daily_reports_v2 split WHERE split.org_id=p_org AND split.driver_id=s.driver_id AND split.report_date=s.shift_date AND split.course_id=s.course_id AND split.rejected_at IS NULL AND coalesce(split.cycle_no,0)>0))))) THEN
    RAISE EXCEPTION 'すべてのシフトの日報を承認してから確定してください' USING ERRCODE='23514';
  END IF;
  UPDATE public.shift_correction_sessions SET closed_at=clock_timestamp(), closed_by=p_actor WHERE id=correction.id;
END $$;

CREATE FUNCTION public.finish_shift_correction_and_finalize(p_org uuid,p_actor uuid,p_session uuid,p_expected jsonb,p_snapshots jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' SET statement_timeout='20s' AS $$
DECLARE c public.shift_correction_sessions%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT FROM public.drivers WHERE id=p_actor AND org_id=p_org AND status='active') THEN RAISE EXCEPTION '対象が見つかりません' USING ERRCODE='P0002'; END IF;
 SELECT * INTO c FROM public.shift_correction_sessions WHERE id=p_session AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '修正が見つかりません' USING ERRCODE='P0002'; END IF;
 IF c.closed_at IS NOT NULL THEN RETURN; END IF;
 PERFORM public.finish_shift_correction(p_org,p_actor,p_session);
 PERFORM public.finalize_report_day(p_org,c.driver_id,c.shift_date,p_expected,p_snapshots);
END $$;
REVOKE ALL ON FUNCTION public.finish_shift_correction_and_finalize(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_shift_correction_and_finalize(uuid,uuid,uuid,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.cancel_report_course_request(p_org uuid,p_driver uuid,p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE q public.report_course_requests%ROWTYPE;
BEGIN
 SELECT * INTO q FROM public.report_course_requests WHERE id=p_id AND org_id=p_org AND driver_id=p_driver AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION '申請はすでに処理されています' USING ERRCODE='40001'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text||':'||p_driver::text||':'||q.report_date::text||':correction',0)) THEN RAISE EXCEPTION '日報が変更されています' USING ERRCODE='40001'; END IF;
 UPDATE public.report_course_requests SET status='cancelled',decided_at=clock_timestamp(),decided_by=p_driver WHERE id=p_id AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION '申請はすでに処理されています' USING ERRCODE='40001'; END IF;
 RETURN public.report_day_revision(p_org,p_driver,q.report_date);
END $$;
REVOKE ALL ON FUNCTION public.cancel_report_course_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_report_course_request(uuid,uuid,uuid) TO service_role;

-- 従来の承認時点ですでに固定された過去単価を再計算しない。確定状態だけを引き継ぐ。
UPDATE public.daily_reports_v2 r SET finalized_at=clock_timestamp(),finalized_shift_snapshot=(
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.shifts s
 WHERE s.driver_id=r.driver_id AND s.shift_date=r.report_date AND s.course_id=r.course_id)
WHERE r.approved_at IS NOT NULL AND r.rejected_at IS NULL AND r.rate_snapshot IS NOT NULL
 AND r.report_date<public.report_finalization_cutoff(clock_timestamp()) AND r.finalized_at IS NULL;

-- 単価固定導入前の承認済み履歴は、現在の単価で遡って再計算しない。
-- 前日分と未承認分は通常どおり対象。過去修正・再承認では対象へ戻す。
UPDATE public.daily_reports_v2 SET finalization_required=false
WHERE approved_at IS NOT NULL AND rejected_at IS NULL AND rate_snapshot IS NULL
 AND report_date < (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date - 1;

CREATE FUNCTION public.edit_report_entries(p_org uuid,p_actor uuid,p_id uuid,p_date date,p_entries jsonb,p_expected timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' SET statement_timeout='15s' AS $$
DECLARE r public.daily_reports_v2%ROWTYPE; item jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM public.drivers WHERE id=p_actor AND org_id=p_org AND status='active') THEN RAISE EXCEPTION '対象が見つかりません' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.daily_reports_v2 WHERE id=p_id AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '日報が見つかりません' USING ERRCODE='P0002'; END IF;
 IF r.submitted_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION '日報が変更されています。再読み込みしてください' USING ERRCODE='40001'; END IF;
 IF r.rejection_reason='shift_changed' THEN RAISE EXCEPTION 'シフト変更で対象外になった日報です。現在のシフトから入力してください' USING ERRCODE='23514'; END IF;
 IF p_entries IS NOT NULL THEN
   item:=jsonb_build_object('courseId',r.course_id,'cycleNo',r.cycle_no,'vehicleId',r.vehicle_id,'meterValue',r.meter_value,'entries',p_entries);
   PERFORM public.validate_report_item(p_org,r.driver_id,coalesce(p_date,r.report_date),item,r.identity_id);
 END IF;
 UPDATE public.daily_reports_v2 SET report_date=coalesce(p_date,report_date),submitted_at=clock_timestamp(),approved_at=NULL,approved_by=NULL,rate_snapshot=NULL,rejected_at=NULL,rejected_by=NULL,rejection_reason=NULL,finalization_required=true WHERE id=p_id;
 IF p_entries IS NOT NULL THEN
   DELETE FROM public.report_entries WHERE report_id=p_id;
   INSERT INTO public.report_entries(org_id,report_id,unit_id,field_key,value_num,value_text)
     SELECT p_org,p_id,(e->>'unitId')::uuid,e->>'fieldKey',(e->>'valueNum')::numeric,e->>'valueText' FROM jsonb_array_elements(p_entries) e;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.edit_report_entries(uuid,uuid,uuid,date,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_report_entries(uuid,uuid,uuid,date,jsonb,timestamptz) TO service_role;

CREATE FUNCTION public.proxy_report_day(p_org uuid,p_actor uuid,p_driver uuid,p_date date,p_items jsonb,p_expected text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' SET statement_timeout='20s' AS $$
DECLARE editable jsonb; saved jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM public.drivers WHERE id=p_actor AND org_id=p_org AND status='active') THEN RAISE EXCEPTION '対象が見つかりません' USING ERRCODE='P0002'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_org::text||':'||p_driver::text||':'||p_date::text||':correction',0)) THEN RAISE EXCEPTION '日報が変更されています' USING ERRCODE='40001'; END IF;
 IF p_expected IS DISTINCT FROM public.report_day_revision(p_org,p_driver,p_date) THEN RAISE EXCEPTION '日報が変更されています' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_items) x WHERE coalesce((x->>'request')::boolean,false)) THEN RAISE EXCEPTION '追加申請を確認してください' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO editable FROM jsonb_array_elements(p_items) x WHERE NOT EXISTS(SELECT FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.driver_id=p_driver AND r.report_date=p_date AND r.course_id=(x->>'courseId')::uuid AND coalesce(r.cycle_no,0)=coalesce((x->>'cycleNo')::int,0) AND r.approved_at IS NOT NULL AND r.rejected_at IS NULL);
 IF jsonb_array_length(editable)=0 THEN RETURN jsonb_build_object('ok',true,'reportIds','[]'::jsonb); END IF;
 saved:=public.submit_report_day(p_org,p_driver,p_date,NULL,editable,p_expected,p_key);
 PERFORM public.decide_report_day(p_org,p_actor,p_driver,p_date,true,NULL,'{}');
 RETURN saved||jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.proxy_report_day(uuid,uuid,uuid,date,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.proxy_report_day(uuid,uuid,uuid,date,jsonb,text,text) TO service_role;

CREATE FUNCTION public.admin_daily_pending_cells(p_org uuid,p_start date,p_end date)
RETURNS TABLE(shift_date date,driver_id uuid) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 WITH sh AS (SELECT s.shift_date,s.driver_id,s.course_id,coalesce(s.cycle_no,0) cycle_no FROM public.shifts s
   JOIN public.drivers d ON d.id=s.driver_id AND d.org_id=p_org AND d.works_as_driver
   WHERE s.shift_date BETWEEN p_start AND p_end),
 rep AS (SELECT r.* FROM public.daily_reports_v2 r WHERE r.org_id=p_org AND r.report_date BETWEEN p_start AND p_end AND r.rejected_at IS NULL)
 SELECT DISTINCT s.shift_date,s.driver_id FROM sh s WHERE NOT EXISTS(SELECT FROM rep r WHERE r.driver_id=s.driver_id AND r.report_date=s.shift_date
   AND r.course_id=s.course_id AND (coalesce(r.cycle_no,0)=s.cycle_no OR (coalesce(r.cycle_no,0)=0 AND NOT EXISTS(SELECT FROM rep split WHERE split.driver_id=r.driver_id AND split.report_date=r.report_date AND split.course_id=r.course_id AND coalesce(split.cycle_no,0)>0))))
 UNION SELECT r.report_date,r.driver_id FROM rep r WHERE r.approved_at IS NULL
 UNION SELECT q.report_date,q.driver_id FROM public.report_course_requests q WHERE q.org_id=p_org AND q.report_date BETWEEN p_start AND p_end AND q.status='pending'
$$;
CREATE OR REPLACE FUNCTION public.admin_daily_pending_dates(p_org uuid,p_start date,p_end date)
RETURNS SETOF date LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT DISTINCT shift_date FROM public.admin_daily_pending_cells(p_org,p_start,p_end) ORDER BY 1 $$;
CREATE OR REPLACE FUNCTION public.admin_daily_unread_count(p_org uuid,p_start date,p_end date)
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT count(*)::int FROM public.admin_daily_pending_cells(p_org,p_start,p_end) $$;
REVOKE ALL ON FUNCTION public.admin_daily_pending_cells(uuid,date,date),public.admin_daily_pending_dates(uuid,date,date),public.admin_daily_unread_count(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_daily_pending_cells(uuid,date,date),public.admin_daily_pending_dates(uuid,date,date),public.admin_daily_unread_count(uuid,date,date) TO service_role;
COMMIT;
