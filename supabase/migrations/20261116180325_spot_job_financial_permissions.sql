-- 配車担当の非金額編集で、非公開の日当・請求額を消さない。
BEGIN;
CREATE FUNCTION public.save_spot_job(p_org uuid,p_actor uuid,p_id uuid,p_patch jsonb,p_members jsonb,p_finance boolean,p_expected timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' SET statement_timeout='15s' AS $$
DECLARE job public.spot_jobs%ROWTYPE; m jsonb; old_member public.spot_job_members%ROWTYPE; mid uuid; pay numeric; kept uuid[]:='{}';
BEGIN
 IF NOT EXISTS(SELECT FROM public.drivers WHERE id=p_actor AND org_id=p_org AND status='active') THEN RAISE EXCEPTION '対象が見つかりません' USING ERRCODE='P0002'; END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR (p_members IS NOT NULL AND (jsonb_typeof(p_members)<>'array' OR jsonb_array_length(p_members)>50)) THEN RAISE EXCEPTION '案件を確認してください' USING ERRCODE='22023'; END IF;
 IF NOT p_finance AND ((p_patch?'billing_amount') OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(p_members,'[]')) x WHERE x?'pay_amount')) THEN RAISE EXCEPTION '金額を変更する権限がありません' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
   INSERT INTO public.spot_jobs(org_id,title,job_date,meeting_place,meeting_time,end_time,client_name,billing_amount,note,status,created_by)
   VALUES(p_org,p_patch->>'title',(p_patch->>'job_date')::date,p_patch->>'meeting_place',(p_patch->>'meeting_time')::time,(p_patch->>'end_time')::time,p_patch->>'client_name',(p_patch->>'billing_amount')::numeric,p_patch->>'note',coalesce(p_patch->>'status','planned'),p_actor) RETURNING * INTO job;
 ELSE
   SELECT * INTO job FROM public.spot_jobs WHERE id=p_id AND org_id=p_org FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION '案件が見つかりません' USING ERRCODE='P0002'; END IF;
   IF p_expected IS NULL OR job.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION '案件が変更されています。再読み込みしてください' USING ERRCODE='40001'; END IF;
   UPDATE public.spot_jobs SET title=CASE WHEN p_patch?'title' THEN p_patch->>'title' ELSE title END,
     job_date=CASE WHEN p_patch?'job_date' THEN (p_patch->>'job_date')::date ELSE job_date END,
     meeting_place=CASE WHEN p_patch?'meeting_place' THEN p_patch->>'meeting_place' ELSE meeting_place END,
     meeting_time=CASE WHEN p_patch?'meeting_time' THEN (p_patch->>'meeting_time')::time ELSE meeting_time END,
     end_time=CASE WHEN p_patch?'end_time' THEN (p_patch->>'end_time')::time ELSE end_time END,
     client_name=CASE WHEN p_patch?'client_name' THEN p_patch->>'client_name' ELSE client_name END,
     billing_amount=CASE WHEN p_patch?'billing_amount' THEN (p_patch->>'billing_amount')::numeric ELSE billing_amount END,
     note=CASE WHEN p_patch?'note' THEN p_patch->>'note' ELSE note END,
     status=CASE WHEN p_patch?'status' THEN p_patch->>'status' ELSE status END,updated_at=clock_timestamp() WHERE id=job.id;
 END IF;
 IF p_members IS NOT NULL THEN
   FOR m IN SELECT * FROM jsonb_array_elements(p_members) LOOP
     old_member:=NULL;
     IF m->>'id' IS NOT NULL THEN
       SELECT * INTO old_member FROM public.spot_job_members WHERE id=(m->>'id')::uuid AND job_id=job.id FOR UPDATE;
       IF NOT FOUND THEN RAISE EXCEPTION '参加者が変更されています' USING ERRCODE='40001'; END IF;
     END IF;
     IF m->>'driver_id' IS NOT NULL AND NOT EXISTS(SELECT FROM public.drivers WHERE id=(m->>'driver_id')::uuid AND org_id=p_org) THEN RAISE EXCEPTION '参加者が見つかりません' USING ERRCODE='P0002'; END IF;
     IF NOT p_finance AND old_member.id IS NOT NULL AND (old_member.driver_id,old_member.display_name) IS DISTINCT FROM ((m->>'driver_id')::uuid,m->>'display_name') THEN RAISE EXCEPTION '参加者を外してから新しい人を追加してください' USING ERRCODE='23514'; END IF;
     pay:=CASE WHEN p_finance THEN (m->>'pay_amount')::numeric ELSE old_member.pay_amount END;
     IF old_member.id IS NULL THEN
       INSERT INTO public.spot_job_members(job_id,driver_id,display_name,pay_amount) VALUES(job.id,(m->>'driver_id')::uuid,m->>'display_name',pay) RETURNING id INTO mid;
     ELSE
       mid:=old_member.id;
       UPDATE public.spot_job_members SET driver_id=(m->>'driver_id')::uuid,display_name=m->>'display_name',pay_amount=pay WHERE id=mid;
     END IF;
     IF mid=ANY(kept) THEN RAISE EXCEPTION '参加者が重複しています' USING ERRCODE='22023'; END IF;
     kept:=array_append(kept,mid);
   END LOOP;
   DELETE FROM public.spot_job_members WHERE job_id=job.id AND NOT(id=ANY(kept));
 END IF;
 RETURN job.id;
END $$;
REVOKE ALL ON FUNCTION public.save_spot_job(uuid,uuid,uuid,jsonb,jsonb,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_spot_job(uuid,uuid,uuid,jsonb,jsonb,boolean,timestamptz) TO service_role;
COMMIT;
