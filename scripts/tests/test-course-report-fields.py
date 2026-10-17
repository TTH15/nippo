#!/usr/bin/env python3
"""架空データ・外部ネットワークなしのPostgresで便と日報項目の保存を検証。"""
import json
import subprocess
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
def run(args, source=None):
    r = subprocess.run(args, input=source, text=True, capture_output=True, cwd=ROOT)
    if r.returncode: raise RuntimeError(r.stderr or r.stdout)
    return r.stdout.strip()
def uid(n): return f'00000000-0000-4000-8000-{n:012d}'
container=run(['docker','run','-d','--pull=never','--network=none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17'])
try:
    for _ in range(40):
        if subprocess.run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0: break
        time.sleep(.2)
    def sql(q): return run(['docker','exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],q)
    def expect(q,want):
        got=sql(q)
        assert got==want,(q,want,got)
    def denied(q,needle=None):
        try: sql(q)
        except RuntimeError as e:
            if needle: assert needle in str(e),str(e)
            return
        raise AssertionError('Expected rejection: '+q)
    sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE courses(id uuid PRIMARY KEY,org_id uuid,carrier_id uuid,uses_cycles boolean);
    CREATE TABLE course_cycles(course_id uuid,cycle_no int,active boolean);
    CREATE TABLE units(id uuid PRIMARY KEY,carrier_id uuid,active boolean);
    CREATE TABLE unit_fields(unit_id uuid,field_key text);
    CREATE TABLE course_report_fields(course_id uuid,cycle_no int,unit_id uuid,field_key text,PRIMARY KEY(course_id,cycle_no,unit_id,field_key));
    CREATE TABLE daily_reports_v2(id uuid PRIMARY KEY,course_id uuid,cycle_no int,approved_at timestamptz,rejected_at timestamptz);
    CREATE TABLE report_entries(report_id uuid,unit_id uuid,field_key text,value_num numeric,value_text text);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;''')
    sql('CREATE ROLE fixture_migrator CREATEROLE BYPASSRLS; ALTER SCHEMA public OWNER TO fixture_migrator; GRANT CREATE, USAGE ON SCHEMA public TO fixture_migrator; ALTER TABLE courses OWNER TO fixture_migrator; ALTER TABLE course_cycles OWNER TO fixture_migrator; ALTER TABLE units OWNER TO fixture_migrator; ALTER TABLE unit_fields OWNER TO fixture_migrator; ALTER TABLE course_report_fields OWNER TO fixture_migrator; ALTER TABLE daily_reports_v2 OWNER TO fixture_migrator; ALTER TABLE report_entries OWNER TO fixture_migrator;')
    sql("SET ROLE fixture_migrator;" + (ROOT/'supabase/migrations/20261017081031_bind_course_report_fields.sql').read_text())
    org,other_org,course,other_course,carrier,other_carrier,unit,other_unit,report,report2,report3=[uid(i) for i in range(1,12)]
    sql(f'''INSERT INTO courses VALUES('{course}','{org}','{carrier}',true),('{other_course}','{other_org}','{other_carrier}',false);
    INSERT INTO course_cycles VALUES('{course}',1,true),('{course}',2,true),('{course}',3,false);
    INSERT INTO units VALUES('{unit}','{carrier}',true),('{other_unit}','{other_carrier}',true);
    INSERT INTO unit_fields VALUES('{unit}','am'),('{unit}','pm'),('{unit}','four'),('{other_unit}','am');
    INSERT INTO daily_reports_v2(id,course_id,cycle_no) VALUES('{report}','{course}',1),('{report2}','{course}',2),('{report3}','{course}',0);
    INSERT INTO report_entries VALUES('{report}','{unit}','pm',7,NULL);''')
    def rows(*pairs): return [dict(cycle_no=c,unit_id=unit,field_key=f) for c,f in pairs]
    def save(selected,expected=None,org_id=org): return f"SET ROLE service_role; SELECT public.replace_course_report_fields('{org_id}','{course}','{json.dumps(selected)}','{json.dumps(expected or [])}');"
    selected=rows((1,'am'),(2,'pm'))
    sql(save(selected))
    denied(f"UPDATE daily_reports_v2 SET approved_at=now() WHERE id='{report}';", '便に対応していない')
    expect(f"SELECT value_num FROM report_entries WHERE report_id='{report}';",'7')
    denied(save(rows((1,'four'))),'別の担当者')
    expect('SELECT count(*) FROM course_report_fields;','2')
    denied(save(rows((3,'am')),selected),'コース・便にない')
    denied(save([dict(cycle_no=1,unit_id=other_unit,field_key='am')],selected),'コース・便にない')
    denied(save(rows((1,'unknown')),selected),'コース・便にない')
    denied(save(rows((1,'am'),(1,'am')),selected),'コース・便にない')
    denied(save(selected,selected,other_org),'コースが見つかりません')
    expect('SELECT count(*) FROM course_report_fields;','2')
    sql(f"SET ROLE service_role; INSERT INTO report_entries VALUES('{report}','{unit}','am',80,NULL),('{report2}','{unit}','pm',40,NULL);")
    denied(f"SET ROLE service_role; INSERT INTO report_entries VALUES('{report}','{unit}','pm',5,NULL);",'便に対応していない')
    denied(f"SET ROLE service_role; INSERT INTO report_entries VALUES('{report2}','{unit}','am',5,NULL);",'便に対応していない')
    denied(f"SET ROLE service_role; INSERT INTO report_entries VALUES('{report}','{unit}','four',5,NULL);",'便に対応していない')
    sql(f"UPDATE report_entries SET value_num=value_num WHERE report_id='{report}';")
    denied(f"UPDATE report_entries SET value_num=8 WHERE report_id='{report}' AND field_key='pm';",'便に対応していない')
    sql(f"UPDATE report_entries SET value_num=0 WHERE report_id='{report}' AND field_key='pm';")
    sql(f"UPDATE daily_reports_v2 SET approved_at=now() WHERE id='{report}';")
    expect(f"SELECT approved_at IS NOT NULL FROM daily_reports_v2 WHERE id='{report}';", 't')
    sql(f"INSERT INTO report_entries VALUES('{report}','{unit}','four',0,NULL),('{report3}','{unit}','four',9,NULL);")
    # 設定を変更しても承認済み実績は変更しない。
    # 共通設定と全項目への互換。既存明細は設定変更しても変化しない。
    common=rows((0,'four'))
    sql(save(common,selected))
    denied(f"INSERT INTO report_entries VALUES('{report}','{unit}','pm',3,NULL);",'便に対応していない')
    sql(f"INSERT INTO report_entries VALUES('{report}','{unit}','four',3,NULL);")
    sql(save([],common))
    sql(f"INSERT INTO report_entries VALUES('{report}','{unit}','pm',3,NULL);")
    sql(save(selected))
    # 設定変更が先なら古い入力は待たずにやり直す。書込が先なら設定側が待つ。
    holder=subprocess.Popen(['docker','exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    holder.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('report-fields:{course}',0)); SELECT 'locked'; SELECT pg_sleep(1); COMMIT;\n");holder.stdin.close()
    assert holder.stdout.readline().strip()==''
    assert holder.stdout.readline().strip()=='locked'
    denied(f"INSERT INTO report_entries VALUES('{report}','{unit}','am',81,NULL);",'日報項目が変更')
    assert holder.wait(timeout=10)==0,holder.stderr.read()
    expect("SELECT has_function_privilege('anon','public.replace_course_report_fields(uuid,uuid,jsonb,jsonb)','execute');",'f')
    expect("SELECT has_function_privilege('authenticated','public.replace_course_report_fields(uuid,uuid,jsonb,jsonb)','execute');",'f')
    expect("SELECT has_function_privilege('service_role','public.guard_report_entry_cycle_fields()','execute');",'f')
    sql('ALTER TABLE daily_reports_v2 ENABLE ROW LEVEL SECURITY; ALTER TABLE course_report_fields ENABLE ROW LEVEL SECURITY;')
    denied(f"SET ROLE service_role; INSERT INTO report_entries VALUES('{report}','{unit}','pm',9,NULL);",'便に対応していない')
    print('PASS: atomic replacement, optimistic conflict, org/carrier/unit/cycle validation, C1-AM/C2-PM, separate fourth run, historical values, zero correction, common/all fallback, config/write race, approval validation, ACL, RLS')
finally:
    run(['docker','rm','--force',container])
