#!/usr/bin/env python3
"""個人権限の保存・会社境界・監査を使い捨てPostgresで検証。"""
import subprocess
import time
from pathlib import Path

root = Path(__file__).resolve().parents[2]
migration = root / "supabase/migrations/20261116153958_member_capability_grants.sql"

def run(args, source=None):
    result = subprocess.run(args, input=source, text=True, capture_output=True, cwd=root)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()

container = run(["docker", "run", "-d", "--pull=never", "--network=none", "--tmpfs", "/var/lib/postgresql/data:rw,size=128m", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"])
try:
    for _ in range(30):
        if subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], capture_output=True).returncode == 0:
            break
        time.sleep(0.2)
    def sql(source):
        return run(["docker", "exec", "-i", container, "psql", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], source)
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE drivers(id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), status text, works_as_driver boolean NOT NULL DEFAULT true);
    CREATE TABLE roles(id uuid PRIMARY KEY, key text, is_system boolean);
    CREATE TABLE role_capabilities(role_id uuid, capability text, PRIMARY KEY(role_id,capability));
    GRANT SELECT, UPDATE ON drivers TO service_role;""")
    sql(migration.read_text())
    org = "00000000-0000-4000-8000-000000000001"
    other = "00000000-0000-4000-8000-000000000002"
    actor = "00000000-0000-4000-8000-000000000003"
    target = "00000000-0000-4000-8000-000000000004"
    stranger = "00000000-0000-4000-8000-000000000005"
    sql(f"""INSERT INTO organizations VALUES ('{org}'), ('{other}');
    INSERT INTO drivers(id,org_id,status) VALUES ('{actor}','{org}','active'), ('{target}','{org}','active'), ('{stranger}','{other}','active');""")
    try:
        sql(f"SET ROLE service_role; SELECT public.set_member_capability_grant('{org}','{actor}','{target}','can_view_profit',true);")
    except RuntimeError:
        pass
    else:
        raise AssertionError("利益を個人追加できてしまった")
    sql(f"SET ROLE service_role; SELECT public.set_member_capability_grant('{org}','{actor}','{target}','can_view_sales',true);")
    sql(f"SET ROLE service_role; SELECT public.set_member_capability_grant('{org}','{actor}','{target}','can_view_sales',true);")
    assert sql("SELECT count(*) FROM member_capability_grants") == "1"
    assert sql("SELECT count(*) FROM member_capability_grant_history") == "1"
    try:
        sql(f"SET ROLE service_role; SELECT public.set_member_capability_grant('{org}','{actor}','{stranger}','can_view_sales',true);")
    except RuntimeError:
        pass
    else:
        raise AssertionError("別会社への権限付与を拒否できなかった")
    assert sql("SELECT has_table_privilege('anon','member_capability_grants','SELECT') OR has_function_privilege('authenticated','public.set_member_capability_grant(uuid,uuid,uuid,text,boolean)','EXECUTE')") == "f"
    sql(f"SET ROLE service_role; SELECT public.set_member_capability_grant('{org}','{actor}','{target}','can_view_sales',false);")
    assert sql("SELECT count(*) FROM member_capability_grants") == "0"
    assert sql("SELECT count(*) FROM member_capability_grant_history") == "2"
    sql("""CREATE TABLE courses(id uuid PRIMARY KEY, org_id uuid REFERENCES organizations(id), archived_at timestamptz, uses_cycles boolean);
    CREATE TABLE course_cycles(course_id uuid REFERENCES courses(id), cycle_no int, active boolean);
    CREATE TABLE shifts(driver_id uuid, shift_date date, course_id uuid, cycle_no int);
    CREATE TABLE daily_reports_v2(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, org_id uuid, driver_id uuid, report_date date, course_id uuid, cycle_no int, rejected_at timestamptz, approved_at timestamptz, rejection_reason text);
    CREATE TABLE report_entries(report_id uuid REFERENCES daily_reports_v2(id), value_num int);
    GRANT SELECT ON courses, course_cycles TO service_role;
    GRANT ALL ON shifts, daily_reports_v2 TO service_role;""")
    sql((root / "supabase/migrations/20261116154418_report_course_requests.sql").read_text())
    assert sql("SELECT relrowsecurity FROM pg_class WHERE oid='public.report_course_requests'::regclass") == "t"
    assert sql("SELECT has_table_privilege('anon','public.report_course_requests','SELECT')") == "f"
    course = "00000000-0000-4000-8000-000000000006"
    sql(f"INSERT INTO courses(id,org_id,uses_cycles) VALUES ('{course}','{org}',true); INSERT INTO course_cycles VALUES ('{course}',1,true);")
    sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{target}','2026-11-15','{course}',1,'{{}}');")
    sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{target}','2026-11-15','{course}',1,'{{\"x\":1}}');")
    try:
        sql(f"INSERT INTO report_course_requests(org_id,driver_id,report_date,course_id,cycle_no,payload) VALUES ('{org}','{target}','2026-11-15','{course}',1,'{{}}');")
    except RuntimeError:
        pass
    else:
        raise AssertionError("承認待ちの重複が拒否されなかった")
    assert sql("SELECT count(*) FROM report_course_requests WHERE status='pending'") == "1"
    assert sql("SELECT payload->>'x' FROM report_course_requests") == "1"
    for driver in [stranger]:
        try:
            sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{driver}','2026-11-15','{course}',1,'{{}}');")
        except RuntimeError:
            pass
        else:
            raise AssertionError("他社のドライバーの申請を拒否できなかった")
    sql(f"INSERT INTO shifts VALUES ('{target}','2026-11-15','{course}',1);")
    # 既存申請の送信後に正式割当が入っても、申請の更新は重複を作らない。
    sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{target}','2026-11-15','{course}',1,'{{}}');")
    sql(f"UPDATE report_course_requests SET status='cancelled',decided_at=now(),decided_by='{target}';")
    try:
        sql(f"SET ROLE service_role; SELECT save_report_course_request('{org}','{target}','2026-11-15','{course}',1,'{{}}');")
    except RuntimeError:
        pass
    else:
        raise AssertionError("割当済みの便を追加申請できてしまった")
    sql("CREATE ROLE hakotora_shift_report_sync NOLOGIN;")
    sql((root / "supabase/migrations/20261116155246_shift_correction_sessions.sql").read_text())
    try:
        sql("UPDATE shifts SET cycle_no=2;")
    except RuntimeError:
        pass
    else:
        raise AssertionError("過去シフトの変更を拒否できなかった")
    sql(f"INSERT INTO daily_reports_v2(org_id,driver_id,report_date,course_id,cycle_no,rejected_at,approved_at) VALUES('{org}','{target}','2026-11-15','{course}',1,NULL,now());")
    try:
        sql("INSERT INTO report_entries SELECT id, 10 FROM daily_reports_v2;")
    except RuntimeError:
        pass
    else:
        raise AssertionError("承認済み日報への明細追加を拒否できなかった")
    try:
        sql("UPDATE daily_reports_v2 SET approved_at=NULL;")
    except RuntimeError:
        pass
    else:
        raise AssertionError("承認済み日報の変更を拒否できなかった")
    try:
        sql("DELETE FROM daily_reports_v2;")
    except RuntimeError:
        pass
    else:
        raise AssertionError("承認済み日報の削除を拒否できなかった")
    session = sql(f"SET ROLE service_role; SELECT begin_shift_correction('{org}','{actor}','{target}','2026-11-15',NULL);")
    sql("UPDATE shifts SET cycle_no=2; UPDATE daily_reports_v2 SET approved_at=NULL; INSERT INTO report_entries SELECT id, 10 FROM daily_reports_v2;")
    for invalid_driver in [target, stranger]:
        try:
            sql(f"SET ROLE service_role; SELECT begin_shift_correction('{org}','{actor}','{invalid_driver}','2026-11-15','修正');")
        except RuntimeError:
            pass
        else:
            raise AssertionError("重複か他社の修正開始を拒否できなかった")
    assert sql("SELECT count(*) FROM shift_correction_sessions WHERE closed_at IS NULL") == "1"
    try:
        sql(f"SET ROLE service_role; SELECT finish_shift_correction('{org}','{actor}','{session}');")
    except RuntimeError:
        pass
    else:
        raise AssertionError("未承認の日報があるのに確定できた")
    sql(f"UPDATE daily_reports_v2 SET approved_at=now(); UPDATE report_course_requests SET status='cancelled',decided_at=now(),decided_by='{target}';")
    sql(f"SET ROLE service_role; SELECT finish_shift_correction('{org}','{actor}','{session}');")
    assert sql("SELECT count(*) FROM shift_correction_sessions WHERE closed_at IS NULL") == "0"
    try:
        sql("UPDATE shifts SET cycle_no=1;")
    except RuntimeError:
        pass
    else:
        raise AssertionError("再確定後の過去シフトを変更できてしまった")
    # 午前3時の切替前は、承認済みでも当日の修正を妨げない。
    sql(f"""INSERT INTO shifts(driver_id,shift_date,course_id,cycle_no)
      VALUES('{target}',((clock_timestamp() AT TIME ZONE 'Asia/Tokyo')-interval '3 hours')::date,'{course}',1);
      INSERT INTO daily_reports_v2(org_id,driver_id,report_date,course_id,cycle_no,approved_at)
      VALUES('{org}','{target}',((clock_timestamp() AT TIME ZONE 'Asia/Tokyo')-interval '3 hours')::date,'{course}',1,now());
      INSERT INTO report_entries SELECT id, 5 FROM daily_reports_v2
        WHERE report_date=((clock_timestamp() AT TIME ZONE 'Asia/Tokyo')-interval '3 hours')::date;
      UPDATE daily_reports_v2 SET approved_at=NULL
        WHERE report_date=((clock_timestamp() AT TIME ZONE 'Asia/Tokyo')-interval '3 hours')::date;
    """)
    assert sql("SELECT (('2026-11-17 02:59:59+09'::timestamptz AT TIME ZONE 'Asia/Tokyo')-interval '3 hours')::date;") == '2026-11-16'
    assert sql("SELECT (('2026-11-17 03:00:00+09'::timestamptz AT TIME ZONE 'Asia/Tokyo')-interval '3 hours')::date;") == '2026-11-17'
    print("個人権限のDB検証成功")
finally:
    subprocess.run(["docker", "rm", "-f", container], capture_output=True)
