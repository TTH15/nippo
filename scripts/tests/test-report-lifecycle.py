#!/usr/bin/env python3
"""本番と同じ列/制約・日報ガード/復旧トリガーをネットワークのないPostgres17に再現。"""
import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def run(args, source=None):
    r = subprocess.run(args, input=source, text=True, capture_output=True, cwd=ROOT)
    if r.returncode:
        raise RuntimeError(r.stderr or r.stdout)
    return r.stdout.strip()

def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'

container = run(['docker', 'run', '-d', '--pull=never', '--network=none', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17'])
try:
    for _ in range(50):
        if subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.2)
    def sql(source):
        return run(['docker', 'exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], source)
    def expect(source, expected):
        actual=sql(source)
        assert actual == expected, (source, expected, actual)
    def denied(source, contains=None):
        try:
            sql(source)
        except RuntimeError as error:
            if contains:
                assert contains in str(error), str(error)
            return
        raise AssertionError('Expected rejection: '+source)
    sql((ROOT/'scripts/tests/fixtures/report-lifecycle-schema.sql').read_text())
    sql('ALTER TABLE daily_reports_v2 DROP COLUMN rejection_reason;')
    migrations=['172_assign_shift_driver.sql','20261017081019_sync_reports_with_shift_changes.sql','20261017081031_bind_course_report_fields.sql','20261104092726_restore_approved_reports_on_shift_reassignment.sql','20261116153958_member_capability_grants.sql','20261116154418_report_course_requests.sql','20261116155246_shift_correction_sessions.sql','20261116174310_report_submission_approval_finalization.sql','20261124110312_restrict_driver_report_course_requests.sql']
    for migration in migrations:
        if migration == '20261116174310_report_submission_approval_finalization.sql':
            # 適用済みの承認時単価を持つ架空履歴。新しい確定ジョブで再計算しない。
            sql(f"""ALTER TABLE shifts DISABLE TRIGGER guard_finalized_shift; INSERT INTO organizations(id,code,name) VALUES('{uid(901)}','legacy-fixture','架空履歴'); INSERT INTO drivers(id,org_id,name,role,status,works_as_driver) VALUES('{uid(902)}','{uid(901)}','過去の担当','DRIVER','active',true); INSERT INTO courses(id,org_id,name) VALUES('{uid(903)}','{uid(901)}','過去のコース'); INSERT INTO shifts(shift_date,course_id,cycle_no,slot,driver_id,org_id) VALUES('2026-10-16','{uid(903)}',0,1,'{uid(902)}','{uid(901)}'); ALTER TABLE shifts ENABLE TRIGGER guard_finalized_shift; INSERT INTO daily_reports_v2(org_id,driver_id,report_date,course_id,cycle_no,approved_at,rate_snapshot) VALUES('{uid(901)}','{uid(902)}','2026-10-16','{uid(903)}',0,'2026-10-16 10:00Z','{{"old_rate":12345}}');""")
        if migration == '20261116174310_report_submission_approval_finalization.sql':
            sql(f"ALTER TABLE daily_reports_v2 DISABLE TRIGGER guard_report_current_shift; INSERT INTO daily_reports_v2(org_id,driver_id,report_date,course_id,cycle_no,approved_at) VALUES('{uid(901)}','{uid(902)}','2026-10-15','{uid(903)}',0,'2026-10-15 10:00Z'); ALTER TABLE daily_reports_v2 ENABLE TRIGGER guard_report_current_shift")
        sql((ROOT/'supabase/migrations'/migration).read_text())
    expect(f"SELECT rate_snapshot->>'old_rate' FROM daily_reports_v2 WHERE driver_id='{uid(902)}' AND report_date='2026-10-16'",'12345')
    expect(f"SELECT approved_at='2026-10-16 10:00Z'::timestamptz AND finalized_at IS NOT NULL AND jsonb_array_length(finalized_shift_snapshot)=1 FROM daily_reports_v2 WHERE driver_id='{uid(902)}' AND report_date='2026-10-16'",'t')
    expect(f"SELECT NOT finalization_required AND finalized_at IS NULL AND rate_snapshot IS NULL FROM daily_reports_v2 WHERE driver_id='{uid(902)}' AND report_date='2026-10-15'",'t')
    expect(f"SELECT jsonb_array_length(report_finalization_source('{uid(901)}','{uid(902)}','2026-10-15')->'reports')",'0')
    # 旧履歴でも、明示的に過去修正して再承認した時点から新しい確定対象へ戻す。
    sql(f"SELECT begin_shift_correction('{uid(901)}','{uid(902)}','{uid(902)}','2026-10-15',NULL); INSERT INTO shifts(org_id,driver_id,shift_date,course_id,cycle_no,slot) VALUES('{uid(901)}','{uid(902)}','2026-10-15','{uid(903)}',0,1); SELECT decide_report_day('{uid(901)}','{uid(902)}','{uid(902)}','2026-10-15',true,NULL,NULL)")
    expect(f"SELECT finalization_required AND approved_at IS NOT NULL FROM daily_reports_v2 WHERE driver_id='{uid(902)}' AND report_date='2026-10-15'",'t')
    sql('TRUNCATE organizations,drivers,courses,shifts,daily_reports_v2,report_entries CASCADE')
    sql((ROOT/'scripts/tests/fixtures/spot-job-schema.sql').read_text())
    sql((ROOT/'supabase/migrations/20261116180325_spot_job_financial_permissions.sql').read_text())
    print('PASS: production columns, constraints, field guards, restoration and new migrations')
    org, other_org, driver, admin, peer, course, other_course, unit, vehicle, identity=[uid(n) for n in range(1,11)]
    sql(f"""INSERT INTO organizations(id,name,code) VALUES('{org}','架空運輸','fictional'),('{other_org}','別会社','other');
    INSERT INTO drivers(id,org_id,name,role,status,works_as_driver) VALUES('{driver}','{org}','架空一郎','DRIVER','active',true),('{admin}','{org}','管理者','ADMIN','active',false),('{peer}','{org}','別の担当','DRIVER','active',true);
    INSERT INTO courses(id,org_id,name,uses_cycles,carrier_id) VALUES('{course}','{org}','北コース',true,'{uid(20)}'),('{other_course}','{other_org}','他社コース',false,'{uid(21)}');
    INSERT INTO course_cycles(course_id,cycle_no,label,active) VALUES('{course}',1,'C1',true),('{course}',2,'C2',true);
    INSERT INTO units(id,carrier_id,name,code,billing_type) VALUES('{unit}','{uid(20)}','宅配','PARCEL','PER_PIECE');
    INSERT INTO unit_fields(unit_id,field_key,label,input_type,is_billable) VALUES('{unit}','completed','完了','INT',true);
    INSERT INTO vehicles(id,owner_org_id,current_mileage) VALUES('{vehicle}','{org}',100);
    INSERT INTO driver_identities(id,driver_id,slot,driver_code) VALUES('{identity}','{driver}',1,'fictional-1');
    """)
    extra_course, second_identity, peer_identity, wildcard_course = [uid(n) for n in range(30,34)]
    sql(f"""INSERT INTO driver_identities(id,driver_id,slot,driver_code) VALUES('{second_identity}','{driver}',2,'fictional-2'),('{peer_identity}','{peer}',1,'fictional-peer');
    INSERT INTO courses(id,org_id,name,uses_cycles,carrier_id) VALUES('{extra_course}','{org}','別担当コース',false,'{uid(20)}'),('{wildcard_course}','{org}','全便担当コース',true,'{uid(20)}');
    INSERT INTO course_cycles(course_id,cycle_no,label,active) VALUES('{wildcard_course}',1,'C1',true),('{wildcard_course}',2,'C2',true),('{wildcard_course}',3,'停止',false);
    INSERT INTO driver_courses(driver_id,driver_identity_id,course_id,cycle_no) VALUES('{driver}','{second_identity}','{course}',2),('{driver}','{identity}','{wildcard_course}',0),('{peer}','{peer_identity}','{extra_course}',0);
    """)
    print('PASS: synthetic seed')
    today=sql("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date")
    date=sql("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date-2")
    def quote(value):
        return "'"+str(value).replace("'","''")+"'"
    def js(value):
        return quote(json.dumps(value,ensure_ascii=False))+"::jsonb"
    def revision(who=driver, day=date):
        return sql(f"SELECT report_day_revision('{org}','{who}','{day}')")
    def item(cycle, quantity, request=False, cid=course):
        return dict(courseId=cid,cycleNo=cycle,vehicleId=vehicle,meterValue=200,request=request,entries=[dict(unitId=unit,fieldKey='completed',valueNum=quantity,valueText=None)])
    def submit(items, key='submission-1', rev=None, day=date, who=driver):
        return sql(f"SET ROLE service_role; SELECT submit_report_day('{org}','{who}','{day}',NULL,{js(items)},{quote(rev or revision(who,day))},{quote(key)})")
    def decision(approve=True, rev=None, ids=None, day=date):
        arr="ARRAY["+','.join(quote(x)+"::uuid" for x in (ids or []))+"]::uuid[]"
        return f"SET ROLE service_role; SELECT decide_report_day('{org}','{admin}','{driver}','{day}',{str(approve).lower()},{quote(rev) if rev else 'NULL'},{arr})"
    def source(day=date):
        return json.loads(sql(f"SET ROLE service_role; SELECT report_finalization_source('{org}','{driver}','{day}')"))
    def snapshots(src):
        return json.loads(run(['node_modules/.bin/tsx','--tsconfig','apps/web/tsconfig.json','scripts/tests/build-finalization-snapshots.ts'],json.dumps(src)))
    def finalize(src=None,snaps=None,day=date):
        src=src or source(day)
        return sql(f"SET ROLE service_role; SELECT finalize_report_day('{org}','{driver}','{day}',{js(src)},{js(snaps if snaps is not None else snapshots(src))})")
    # 設置前から存在する過去のシフトを架空データで再現。
    sql(f"ALTER TABLE shifts DISABLE TRIGGER guard_finalized_shift; INSERT INTO shifts(org_id,shift_date,course_id,cycle_no,slot,driver_id) VALUES('{org}','{date}','{course}',1,1,'{driver}'),('{org}','{date}','{course}',2,1,'{peer}'); ALTER TABLE shifts ENABLE TRIGGER guard_finalized_shift;")
    # 本番同様にRLS有効。同期/項目ガード専用ロールの列権限も実際に評価する。
    sql('ALTER TABLE courses ENABLE ROW LEVEL SECURITY; ALTER TABLE shifts ENABLE ROW LEVEL SECURITY; ALTER TABLE daily_reports_v2 ENABLE ROW LEVEL SECURITY; ALTER TABLE report_entries ENABLE ROW LEVEL SECURITY; ALTER TABLE course_report_fields ENABLE ROW LEVEL SECURITY;')
    sql(f"INSERT INTO course_unit_rates(course_id,cycle_no,unit_id,revenue_per_unit,payout_per_unit) VALUES('{course}',0,'{unit}',150,100)")
    expect("SELECT report_finalization_cutoff('2026-11-17 02:59:59+09'),report_finalization_cutoff('2026-11-17 03:00:00+09')",'2026-11-16|2026-11-17')
    items=[item(1,10),item(2,20,True)]
    # 候補取得後の担当解除・別人のみの紐付け・別便による偽装を保存入口で拒否。
    denied(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{date}','{course}',1,'{{}}')",'担当コース')
    denied(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{date}','{extra_course}',0,'{{}}')",'担当コース')
    denied(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{date}','{wildcard_course}',3,'{{}}')")
    wildcard_request=sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{date}','{wildcard_course}',2,'{{}}')")
    expect(f"SELECT cycle_no FROM report_course_requests WHERE id='{wildcard_request}'",'2')
    sql(f"DELETE FROM report_course_requests WHERE id='{wildcard_request}'")
    denied(f"SET ROLE service_role; SELECT submit_report_day('{org}','{driver}','{date}',NULL,{js([item(1,10),item(0,21,True,extra_course)])},{quote(revision())},'unauthorized-mixed')",'担当コース')
    expect("SELECT count(*) FROM daily_reports_v2",'0')
    expect("SELECT count(*) FROM report_submission_receipts",'0')
    print('PASS: unassigned course/cycle denied in both save paths; wildcard applies to active cycles only; ad-hoc assigned report remains valid')
    rev=revision(); result=json.loads(submit(items,rev=rev)); q=result['requestIds'][0]; rid=result['reportIds'][0]
    expect(f"SELECT count(*) FROM shifts WHERE driver_id='{driver}' AND shift_date='{date}'",'1')
    expect(f"SELECT count(*) FROM daily_reports_v2 WHERE approved_at IS NOT NULL",'0')
    assert json.loads(submit(items,rev=rev))==result
    expect('SELECT count(*) FROM report_course_requests','1')
    denied(f"SELECT submit_report_day('{org}','{driver}','{date}',NULL,{js(items)},{quote(rev)},'stale-form')",'変更')
    denied(decision(), '追加申請')
    denied(decision(rev=rev,ids=[q]),'変更')
    # 他社・廃止便は拒否。
    denied(f"SELECT save_report_course_request('{org}','{driver}','{date}','{other_course}',0,'{{}}')")
    denied(f"SELECT save_report_course_request('{org}','{driver}','{date}','{course}',9,'{{}}')")
    # 承認中の明細保存失敗でシフト・日報・走行距離・申請も巻き戻る。
    sql("CREATE FUNCTION fixture_fail_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.value_num=20 THEN RAISE EXCEPTION 'fixture-entry-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_fail_entry BEFORE INSERT ON report_entries FOR EACH ROW EXECUTE FUNCTION fixture_fail_entry();")
    denied(decision(rev=revision(),ids=[q]),'fixture-entry-failure')
    expect(f"SELECT count(*) FROM shifts WHERE driver_id='{driver}' AND shift_date='{date}'",'1')
    expect(f"SELECT status FROM report_course_requests WHERE id='{q}'",'pending')
    expect(f"SELECT current_mileage FROM vehicles WHERE id='{vehicle}'",'100')
    sql('DROP TRIGGER fixture_fail_entry ON report_entries')
    # 保存後に便の入力設定が変われば、承認・割当を一部だけ進めない。
    sql(f"INSERT INTO unit_fields(unit_id,field_key,label,input_type) VALUES('{unit}','morning','午前','INT'); INSERT INTO course_report_fields(course_id,cycle_no,unit_id,field_key) VALUES('{course}',2,'{unit}','morning')")
    denied(decision(rev=revision(),ids=[q]),'日報項目')
    expect(f"SELECT status FROM report_course_requests WHERE id='{q}'",'pending')
    sql('DELETE FROM course_report_fields')
    # 枠1は別人。追加の枠を取り、同日本人分だけ反映。
    sql(decision(rev=revision(),ids=[q]))
    expect(f"SELECT count(*) FROM shifts WHERE driver_id='{driver}' AND shift_date='{date}'",'2')
    expect(f"SELECT driver_id FROM shifts WHERE course_id='{course}' AND shift_date='{date}' AND cycle_no=2 AND slot=1",peer)
    expect("SELECT count(*) FROM daily_reports_v2 WHERE approved_at IS NOT NULL AND rate_snapshot IS NULL AND finalized_at IS NULL",'2')
    expect(f"SELECT current_mileage FROM vehicles WHERE id='{vehicle}'",'200')
    expect('SELECT count(*) FROM shift_change_logs','1')
    denied(decision(rev=revision(),ids=[q]),'承認待ち')
    print('PASS: submit, reload source, retry, tenant/cycle checks, atomic approval rollback, safe slot allocation')
    # 3時の対象外は承認済みでも固定しない。過去の未承認シフトも通常編集から保護。
    denied(f"UPDATE shifts SET meeting_time='09:00' WHERE driver_id='{driver}' AND shift_date='{date}'",'過去')
    expect(f"SELECT finalize_report_day('{org}','{driver}','{today}','{{}}','{{}}')",'0')
    old_source=source()
    sql(f"UPDATE course_unit_rates SET revenue_per_unit=160 WHERE course_id='{course}'")
    try:
        finalize(old_source)
        raise AssertionError('stale rate must conflict')
    except RuntimeError as error:
        assert '変更' in str(error)
    expect('SELECT count(*) FROM daily_reports_v2 WHERE finalized_at IS NOT NULL','0')
    src=source(); calc=snapshots(src)
    assert calc[rid]['components'][0]['revenue']==1600
    assert finalize(src,calc)=='2'
    expect(f"SELECT finalized_at IS NOT NULL AND rate_snapshot->'components'->0->>'revenue'='1600' AND finalized_shift_snapshot IS NOT NULL FROM daily_reports_v2 WHERE id='{rid}'",'t')
    sql(f"UPDATE course_unit_rates SET revenue_per_unit=999 WHERE course_id='{course}'")
    expect(f"SELECT rate_snapshot->'components'->0->>'revenue' FROM daily_reports_v2 WHERE id='{rid}'",'1600')
    denied(f"UPDATE report_entries SET value_num=11 WHERE report_id='{rid}'",'確定済み')
    denied(f"UPDATE daily_reports_v2 SET approved_at=NULL WHERE id='{rid}'",'確定済み')
    assert finalize()=='0'
    print('PASS: 03:00 boundary, unapproved/past protection, rate conflict, real calculation, immutable quantities/rates/shifts, idempotent finalization')
    # 管理者の修正開始で数量を保持し、再承認するまで再確定できない。
    correction=sql(f"SET ROLE service_role; SELECT begin_shift_correction('{org}','{admin}','{driver}','{date}',NULL)")
    expect('SELECT count(*) FROM daily_reports_v2 WHERE approved_at IS NOT NULL OR finalized_at IS NOT NULL','0')
    expect(f"SELECT value_num FROM report_entries WHERE report_id='{rid}'",'10')
    expect(f"SELECT item->>'value_num' FROM shift_correction_sessions s CROSS JOIN LATERAL jsonb_array_elements(s.original_state->'entries') item WHERE s.id='{correction}' AND item->>'report_id'='{rid}'",'10')
    sql(f"SET ROLE service_role; UPDATE shifts SET meeting_time='09:00' WHERE driver_id='{driver}' AND shift_date='{date}'; UPDATE report_entries SET value_num=11 WHERE report_id='{rid}'")
    assert finalize()=='0'
    denied(f"SELECT finish_shift_correction('{org}','{admin}','{correction}')",'承認')
    sql(decision())
    src=source(); calc=snapshots(src)
    # 再確定失敗は修正セッションも閉じない。
    denied(f"SELECT finish_shift_correction_and_finalize('{org}','{admin}','{correction}',{js(src)},'{{}}')",'単価')
    expect(f"SELECT closed_at IS NULL FROM shift_correction_sessions WHERE id='{correction}'",'t')
    sql(f"SET ROLE service_role; SELECT finish_shift_correction_and_finalize('{org}','{admin}','{correction}',{js(src)},{js(calc)})")
    expect(f"SELECT rate_snapshot->'components'->0->>'revenue' FROM daily_reports_v2 WHERE id='{rid}'",'10989')
    sql(f"SELECT finish_shift_correction_and_finalize('{org}','{admin}','{correction}','{{}}','{{}}')")
    denied(f"UPDATE shifts SET meeting_time='10:00' WHERE driver_id='{driver}' AND shift_date='{date}'",'過去')
    print('PASS: correction, preserved quantity, reapproval required, rollback on refinalization failure, refinalized actual rates')

    # ロック保持中は別経路の数量変更・修正開始を拒否し、入力済み値はそのまま。
    holder=subprocess.Popen(['docker','exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    holder.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('{org}:{driver}:{date}:correction',0)); SELECT 'locked'; SELECT pg_sleep(4); COMMIT;\n")
    holder.stdin.close()
    while holder.stdout.readline().strip()!='locked':
        assert holder.poll() is None, 'lock holder exited'
    denied(f"SET ROLE service_role; SELECT begin_shift_correction('{org}','{admin}','{driver}','{date}',NULL)",'changed')
    holder.wait(timeout=10)
    # 修正で増やした枠に日報がなければ閉じず、全枠を外した日は復旧トリガーの除外履歴を残して閉じる。
    correction=sql(f"SET ROLE service_role; SELECT begin_shift_correction('{org}','{admin}','{driver}','{date}',NULL)")
    sql(decision())
    sql(f"INSERT INTO course_cycles(course_id,cycle_no,label,active) VALUES('{course}',3,'C3',true); INSERT INTO shifts(org_id,driver_id,shift_date,course_id,cycle_no,slot) VALUES('{org}','{driver}','{date}','{course}',3,1)")
    denied(f"SELECT finish_shift_correction('{org}','{admin}','{correction}')",'すべてのシフト')
    expect(f"SELECT closed_at IS NULL FROM shift_correction_sessions WHERE id='{correction}'",'t')
    sql(f"DELETE FROM shifts WHERE driver_id='{driver}' AND shift_date='{date}'")
    expect(f"SELECT count(*) FROM daily_reports_v2 WHERE driver_id='{driver}' AND report_date='{date}' AND rejection_reason='shift_changed'",'2')
    src=source(); calc=snapshots(src)
    sql(f"SET ROLE service_role; SELECT finish_shift_correction_and_finalize('{org}','{admin}','{correction}',{js(src)},{js(calc)})")
    expect(f"SELECT closed_at IS NOT NULL FROM shift_correction_sessions WHERE id='{correction}'",'t')
    print('PASS: missing report prevents correction closure; complete removal retains exclusion history and closes safely')
    # 追加だけの日は承認待ち領域にあり、バッジ/日付一覧で取りこぼさない。
    request_day=sql("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date-3")
    q_payload=dict(vehicleId=vehicle,meterValue=300,identityId=None,entries=[dict(unitId=unit,fieldKey='completed',valueNum=9,valueText=None)])
    q_only=sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{request_day}','{course}',2,{js(q_payload)})")
    sql(f"DELETE FROM driver_courses WHERE driver_identity_id='{second_identity}' AND course_id='{course}'")
    same_q=sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{request_day}','{course}',2,{js(q_payload)})")
    assert same_q==q_only
    assert json.loads(submit([item(2,12,True)],key='existing-request',day=request_day))['requestIds']==[q_only]
    expect(f"SELECT admin_daily_unread_count('{org}','{request_day}','{request_day}')",'1')
    expect(f"SELECT admin_daily_pending_dates('{org}','{request_day}','{request_day}')",request_day)
    expect(f"SELECT count(*) FROM daily_reports_v2 WHERE report_date='{request_day}'",'0')
    sql(decision(False,revision(day=request_day),[q_only],request_day))
    expect(f"SELECT status FROM report_course_requests WHERE id='{q_only}'",'rejected')
    expect(f"SELECT count(*) FROM shifts WHERE driver_id='{driver}' AND shift_date='{request_day}'",'0')
    denied(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{request_day}','{course}',2,{js(q_payload)})",'担当コース')
    sql(f"INSERT INTO driver_courses(driver_id,driver_identity_id,course_id,cycle_no) VALUES('{driver}','{second_identity}','{course}',2)")
    q_again=sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','{request_day}','{course}',2,{js(q_payload)})")
    assert q_again!=q_only
    sql(f"SET ROLE service_role; SELECT cancel_report_course_request('{org}','{driver}','{q_again}')")
    expect(f"SELECT admin_daily_unread_count('{org}','{request_day}','{request_day}')",'0')
    denied(f"SET ROLE anon; SELECT report_day_revision('{org}','{driver}','{date}')",'permission denied')
    denied("SET ROLE authenticated; SELECT * FROM report_course_requests",'permission denied')
    print('PASS: parallel correction lock, request-only pending badge, rejection/resubmission/cancellation, private table/function access')

    # 承認RPCの他社所有車: 別日貸与は拒否、同日の正式貸与だけ更新する。
    foreign_vehicle=uid(800)
    sql(f"INSERT INTO vehicles(id,owner_org_id,current_mileage) VALUES('{foreign_vehicle}','{other_org}',250); INSERT INTO shifts(org_id,shift_date,course_id,cycle_no,slot,driver_id) VALUES('{org}','{today}','{course}',1,1,'{driver}'); INSERT INTO daily_reports_v2(org_id,driver_id,report_date,course_id,cycle_no,vehicle_id,meter_value) VALUES('{org}','{driver}','{today}','{course}',1,'{foreign_vehicle}',300)")
    denied(decision(day=today),'車両')
    sql(f"INSERT INTO vehicle_loans(vehicle_id,borrower_org_id,loan_date) VALUES('{foreign_vehicle}','{org}','{date}')")
    denied(decision(day=today),'車両')
    sql(f"UPDATE vehicle_loans SET loan_date='{today}' WHERE vehicle_id='{foreign_vehicle}'")
    sql(decision(day=today))
    expect(f"SELECT current_mileage FROM vehicles WHERE id='{foreign_vehicle}'",'300')
    expect(f"SELECT rate_snapshot IS NULL AND finalized_at IS NULL FROM daily_reports_v2 WHERE driver_id='{driver}' AND report_date='{today}'",'t')
    print('PASS: real approval rejects foreign vehicles and wrong-day loans; valid loan updates authorized owner mileage')
    # 単発案件: 金額を見ない配車の編集でも既存の請求額・日当を保全する。
    job_patch=dict(title='架空応援',job_date=today,billing_amount=30000)
    members=[dict(driver_id=driver,display_name=None,pay_amount=18000)]
    job=sql(f"SET ROLE service_role; SELECT save_spot_job('{org}','{admin}',NULL,{js(job_patch)},{js(members)},true,NULL)")
    version=sql(f"SELECT updated_at FROM spot_jobs WHERE id='{job}'")
    mid=sql(f"SELECT id FROM spot_job_members WHERE job_id='{job}'")
    hidden=[dict(id=mid,driver_id=driver,display_name=None),dict(driver_id=peer,display_name=None)]
    sql(f"SET ROLE service_role; SELECT save_spot_job('{org}','{admin}','{job}',{js(dict(title='応援修正'))},{js(hidden)},false,{quote(version)})")
    expect(f"SELECT billing_amount FROM spot_jobs WHERE id='{job}'",'30000')
    expect(f"SELECT pay_amount FROM spot_job_members WHERE id='{mid}'",'18000')
    denied(f"SELECT save_spot_job('{org}','{admin}','{job}','{{}}','[]',false,{quote(version)})",'変更')
    version=sql(f"SELECT updated_at FROM spot_jobs WHERE id='{job}'")
    denied(f"SELECT save_spot_job('{org}','{admin}','{job}',{js(dict(billing_amount=None))},NULL,false,{quote(version)})",'権限')
    denied(f"SELECT save_spot_job('{other_org}','{admin}','{job}','{{}}',NULL,true,{quote(version)})")
    denied(f"SELECT save_spot_job('{org}','{admin}','{job}',{js(dict(title='失敗で戻る'))},{js([dict(id=uid(999),driver_id=driver,display_name=None)])},false,{quote(version)})",'変更')
    expect(f"SELECT title FROM spot_jobs WHERE id='{job}'",'応援修正')
    print('PASS: spot-job hidden amounts preserved, participant addition, stale version, tenant/money denial, atomic rollback')

finally:
    subprocess.run(['docker','rm','-f',container],capture_output=True)
