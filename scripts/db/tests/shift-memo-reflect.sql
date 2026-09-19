-- shift-memo-reflect-setup.sql と migration 165 の後、専用テストDBで実行する。
DO $$ BEGIN IF current_database()<>'hakotora_memo_test' THEN RAISE EXCEPTION 'Dedicated test database required'; END IF; END $$;
BEGIN;
CREATE FUNCTION pg_temp.uid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.g(day text, course int, cycle int, people int[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('date',day,'courseId',pg_temp.uid(course),'cycleNo',cycle,'driverIds',coalesce((SELECT jsonb_agg(pg_temp.uid(n)) FROM unnest(people) n),'[]'::jsonb)))
$$;
CREATE FUNCTION pg_temp.preview(groups jsonb, mode text DEFAULT 'replace') RETURNS jsonb LANGUAGE sql AS $$ SELECT reflect_shift_memo(pg_temp.uid(1),pg_temp.uid(10),groups,mode) $$;
CREATE FUNCTION pg_temp.apply(groups jsonb, mode text DEFAULT 'replace') RETURNS jsonb LANGUAGE sql AS $$ SELECT reflect_shift_memo(pg_temp.uid(1),pg_temp.uid(10),groups,mode,pg_temp.preview(groups,mode)->>'revision') $$;
CREATE FUNCTION pg_temp.rejects(groups jsonb, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN BEGIN PERFORM pg_temp.preview(groups); EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
  PERFORM pg_temp.assert(caught=expected,'rejects '||expected||' actual '||coalesce(caught,'success')); END $$;

INSERT INTO organizations VALUES(pg_temp.uid(1)),(pg_temp.uid(2));
INSERT INTO drivers(id,org_id,name) SELECT pg_temp.uid(n),pg_temp.uid(CASE WHEN n=20 THEN 2 ELSE 1 END),'架空'||n FROM generate_series(10,20) n;
INSERT INTO courses(id,org_id,name,uses_cycles) VALUES(pg_temp.uid(100),pg_temp.uid(1),'架空C1/C2',true),(pg_temp.uid(101),pg_temp.uid(1),'架空別コース',false),(pg_temp.uid(200),pg_temp.uid(2),'他社',false);
INSERT INTO course_cycles VALUES(pg_temp.uid(100),1,true),(pg_temp.uid(100),2,true),(pg_temp.uid(100),3,false);
INSERT INTO shifts(shift_date,course_id,cycle_no,slot,driver_id,vehicle_id,meeting_time,import_batch_id) VALUES
  ('2026-09-16',pg_temp.uid(100),1,1,pg_temp.uid(11),pg_temp.uid(500),'08:00',pg_temp.uid(900)),
  ('2026-09-16',pg_temp.uid(100),1,2,pg_temp.uid(12),pg_temp.uid(501),'09:00',pg_temp.uid(900)),
  ('2026-09-16',pg_temp.uid(100),2,1,pg_temp.uid(11),pg_temp.uid(500),'14:00',NULL),
  ('2026-09-17',pg_temp.uid(100),1,1,pg_temp.uid(11),NULL,NULL,NULL),
  ('2026-09-16',pg_temp.uid(200),0,1,pg_temp.uid(20),NULL,NULL,NULL);

DO $$ DECLARE p jsonb; snap jsonb; groups jsonb:=pg_temp.g('2026-09-16',100,1,ARRAY[11,13]); BEGIN
  SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO snap FROM shifts s;
  p:=pg_temp.preview(groups);
  PERFORM pg_temp.assert((p->>'added')::int=1 AND (p->>'removed')::int=1 AND (p->>'kept')::int=1,'replace diff');
  PERFORM pg_temp.assert(snap=(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM shifts s),'preview read only');
  PERFORM pg_temp.assert((SELECT count(*)=0 FROM shift_change_logs),'preview has no logs');
  PERFORM pg_temp.assert((pg_temp.preview(groups,'add')->>'removed')::int=0,'add preserves others');
  p:=pg_temp.apply(groups);
  PERFORM pg_temp.assert((p->>'applied')::boolean,'apply flag');
  PERFORM pg_temp.assert((SELECT vehicle_id=pg_temp.uid(500) AND meeting_time='08:00' AND import_batch_id=pg_temp.uid(900) FROM shifts WHERE shift_date='2026-09-16' AND course_id=pg_temp.uid(100) AND cycle_no=1 AND driver_id=pg_temp.uid(11)),'unchanged driver metadata preserved');
  PERFORM pg_temp.assert((SELECT slot=2 AND vehicle_id IS NULL AND meeting_time IS NULL AND import_batch_id IS NULL FROM shifts WHERE shift_date='2026-09-16' AND course_id=pg_temp.uid(100) AND cycle_no=1 AND driver_id=pg_temp.uid(13)),'replacement reuses cleared slot without metadata');
  PERFORM pg_temp.assert((SELECT count(*)=1 FROM shifts WHERE course_id=pg_temp.uid(200) AND driver_id=pg_temp.uid(20)),'other organization preserved');
  PERFORM pg_temp.assert((SELECT count(*)=1 FROM shifts WHERE shift_date='2026-09-17' AND driver_id=pg_temp.uid(11)),'other day preserved');
  PERFORM pg_temp.assert((SELECT count(*)=1 FROM shifts WHERE cycle_no=2 AND driver_id=pg_temp.uid(11)),'other cycle preserved');
  PERFORM pg_temp.assert((SELECT count(*)=2 FROM shift_change_logs),'one log per change');
  PERFORM pg_temp.assert((pg_temp.preview(groups)->>'added')::int=0 AND (pg_temp.preview(groups)->>'removed')::int=0,'repeat is no-op');
  PERFORM pg_temp.apply(groups);
  PERFORM pg_temp.assert((SELECT count(*)=2 FROM shift_change_logs),'no duplicate logs on repeat');
END $$;

-- 無効な入力や自社外の参照を拒否。
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',200,0,ARRAY[11]),'P0002');
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',100,1,ARRAY[20]),'P0002');
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',100,3,ARRAY[11]),'P0002');
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',100,0,ARRAY[11]),'P0002');
SELECT pg_temp.rejects(pg_temp.g('2026-02-30',100,1,ARRAY[11]),'22008');
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',100,1,ARRAY[11,11]),'22023');
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',100,1,ARRAY[11])||pg_temp.g('2026-09-16',100,1,ARRAY[12]),'22023');
SELECT pg_temp.rejects('[]','22023');
SELECT pg_temp.rejects('null','22023');
UPDATE drivers SET status='inactive' WHERE id=pg_temp.uid(19);
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',100,1,ARRAY[19]),'P0002');
UPDATE courses SET archived_at=now() WHERE id=pg_temp.uid(101);
SELECT pg_temp.rejects(pg_temp.g('2026-09-16',101,0,ARRAY[11]),'P0002');
UPDATE courses SET archived_at=NULL WHERE id=pg_temp.uid(101);

-- 変更確認後の追加・車両変更を検出して、反映を全部拒否。
DO $$ DECLARE groups jsonb:=pg_temp.g('2026-09-16',100,1,ARRAY[11]); rev text; caught text; BEGIN
  rev:=pg_temp.preview(groups)->>'revision';
  UPDATE shifts SET vehicle_id=pg_temp.uid(505) WHERE course_id=pg_temp.uid(100) AND cycle_no=1 AND driver_id=pg_temp.uid(11);
  BEGIN PERFORM reflect_shift_memo(pg_temp.uid(1),pg_temp.uid(10),groups,'replace',rev); EXCEPTION WHEN serialization_failure THEN caught:=SQLSTATE; END;
  PERFORM pg_temp.assert(caught='40001','revision conflict');
  PERFORM pg_temp.assert((SELECT count(*)=1 FROM shifts WHERE cycle_no=1 AND driver_id=pg_temp.uid(13)),'conflict performs no delete');
END $$;

-- 別コースと希望休は警告、同じコースのC1/C2は正常。
INSERT INTO shifts(shift_date,course_id,slot,driver_id) VALUES('2026-09-16',pg_temp.uid(101),1,pg_temp.uid(14));
INSERT INTO shift_requests(driver_id,request_date) VALUES(pg_temp.uid(14),'2026-09-16');
DO $$ DECLARE p jsonb; BEGIN
  p:=pg_temp.preview(pg_temp.g('2026-09-16',100,1,ARRAY[14]));
  PERFORM pg_temp.assert(jsonb_array_length(p->'warnings')=2,'off and other course warnings');
  p:=pg_temp.preview(pg_temp.g('2026-09-16',100,1,ARRAY[11])||pg_temp.g('2026-09-16',100,2,ARRAY[11]));
  PERFORM pg_temp.assert(jsonb_array_length(p->'warnings')=0,'same course cycles allowed');
END $$;

-- 途中のログ失敗でも配置と解除をまとめてロールバック。
CREATE FUNCTION pg_temp.fail_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='assign_driver' THEN RAISE EXCEPTION 'test log failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_fail_log BEFORE INSERT ON shift_change_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_log();
DO $$ DECLARE snap jsonb; caught boolean:=false; BEGIN
  SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO snap FROM shifts s;
  BEGIN PERFORM pg_temp.apply(pg_temp.g('2026-09-16',100,1,ARRAY[15])); EXCEPTION WHEN raise_exception THEN caught:=true; END;
  PERFORM pg_temp.assert(caught AND snap=(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM shifts s),'atomic rollback');
END $$;
DROP TRIGGER test_fail_log ON shift_change_logs;

SELECT pg_temp.apply(pg_temp.g('2026-09-16',100,1,ARRAY[]::int[]));
SELECT pg_temp.assert((SELECT count(*)=0 FROM shifts WHERE shift_date='2026-09-16' AND course_id=pg_temp.uid(100) AND cycle_no=1 AND driver_id IS NOT NULL),'explicit empty clears target');
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.reflect_shift_memo(uuid,uuid,jsonb,text,text)','EXECUTE'),'anon blocked');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.reflect_shift_memo(uuid,uuid,jsonb,text,text)','EXECUTE'),'authenticated blocked');
SELECT pg_temp.assert(has_function_privilege('service_role','public.reflect_shift_memo(uuid,uuid,jsonb,text,text)','EXECUTE'),'service role allowed');
ROLLBACK;
SELECT 'shift memo reflect: all assertions passed' AS result;
