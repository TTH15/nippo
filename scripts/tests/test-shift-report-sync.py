#!/usr/bin/env python3
"""本番へ接続しない。架空データのPostgres17で日報とシフトの連動を検証。"""
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261017081019_sync_reports_with_shift_changes.sql'


def run(args, source=None):
    result = subprocess.run(args, input=source, text=True, capture_output=True, cwd=ROOT)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()


def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'


container = run(['docker', 'run', '-d', '--pull=never', '--network=none',
                 '--tmpfs', '/var/lib/postgresql/data:rw,size=128m',
                 '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17'])
try:
    for _ in range(30):
        if subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(0.2)

    def sql(source):
        return run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], source)

    def expect(source, expected):
        actual = sql(source)
        assert actual == expected, (source, expected, actual)

    def denied(source):
        try:
            sql(source)
        except RuntimeError:
            return
        raise AssertionError('Expected rejection: ' + source)

    sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE courses(id uuid PRIMARY KEY, org_id uuid);
    CREATE TABLE drivers(id uuid PRIMARY KEY, org_id uuid, works_as_driver boolean);
    CREATE TABLE shifts(id uuid PRIMARY KEY, org_id uuid, driver_id uuid, shift_date date,
      course_id uuid, cycle_no integer, slot integer, vehicle_id uuid, meeting_time time);
    CREATE TABLE daily_reports_v2(id uuid PRIMARY KEY, org_id uuid, driver_id uuid, report_date date,
      course_id uuid, cycle_no integer, submitted_at timestamptz DEFAULT now(), approved_at timestamptz,
      approved_by uuid, rejected_at timestamptz, rejected_by uuid, rate_snapshot jsonb);
    CREATE TABLE report_entries(report_id uuid, value_num integer);
    GRANT ALL ON courses, shifts, daily_reports_v2, report_entries TO service_role;''')
    sql('CREATE ROLE fixture_migrator CREATEROLE BYPASSRLS; ALTER SCHEMA public OWNER TO fixture_migrator; GRANT CREATE, USAGE ON SCHEMA public TO fixture_migrator; ALTER TABLE courses OWNER TO fixture_migrator; ALTER TABLE shifts OWNER TO fixture_migrator; ALTER TABLE drivers OWNER TO fixture_migrator; ALTER TABLE daily_reports_v2 OWNER TO fixture_migrator; ALTER TABLE report_entries OWNER TO fixture_migrator;')
    sql("SET ROLE fixture_migrator;" + MIGRATION.read_text())
    org, driver, course, other_course, peer, other_org = [uid(n) for n in range(1, 7)]

    def seed():
        sql(f'''TRUNCATE courses, shifts, daily_reports_v2, report_entries;
        INSERT INTO courses VALUES('{course}','{org}'),('{other_course}','{other_org}');
        INSERT INTO shifts(id,org_id,driver_id,shift_date,course_id,cycle_no,slot) VALUES
          ('{uid(10)}','{org}','{driver}','2026-10-16','{course}',1,1),
          ('{uid(11)}','{org}','{driver}','2026-10-16','{course}',2,1),
          ('{uid(12)}','{org}','{peer}','2026-10-16','{course}',1,2),
          ('{uid(13)}','{other_org}','{peer}','2026-10-16','{other_course}',1,1),
          ('{uid(14)}','{org}','{driver}','2026-10-15','{course}',1,1);
        INSERT INTO daily_reports_v2(id,org_id,driver_id,report_date,course_id,cycle_no,approved_at,rate_snapshot) VALUES
          ('{uid(20)}','{org}','{driver}','2026-10-16','{course}',1,now(),'{{"fixed":10000}}'),
          ('{uid(21)}','{org}','{driver}','2026-10-16','{course}',2,NULL,NULL),
          ('{uid(22)}','{org}','{peer}','2026-10-16','{course}',1,now(),NULL),
          ('{uid(23)}','{other_org}','{peer}','2026-10-16','{other_course}',1,now(),NULL),
          ('{uid(24)}','{org}','{driver}','2026-10-15','{course}',1,now(),NULL);
        INSERT INTO report_entries VALUES('{uid(20)}',123);''')

    sql(f"INSERT INTO drivers VALUES('{driver}','{org}',true),('{peer}','{org}',false);")
    seed()
    # 承認済みC1だけでは新しいC2を提出済みにしない。DB側の一覧・バッジ両方を確認。
    sql(f"DELETE FROM daily_reports_v2 WHERE id='{uid(21)}';")
    expect(f"SELECT count(*) FROM admin_daily_pending_dates('{org}','2026-10-16','2026-10-16');", '1')
    expect(f"SELECT admin_daily_unread_count('{org}','2026-10-16','2026-10-16');", '1')
    # 旧全体日報は便別が無い間だけ全便をカバーする。
    sql(f"DELETE FROM daily_reports_v2 WHERE id='{uid(20)}'; INSERT INTO shifts(id,org_id,driver_id,shift_date,course_id,cycle_no) VALUES('{uid(17)}','{org}','{driver}','2026-10-16','{course}',0); INSERT INTO daily_reports_v2(id,org_id,driver_id,report_date,course_id,cycle_no,approved_at) VALUES('{uid(27)}','{org}','{driver}','2026-10-16','{course}',0,now()); DELETE FROM shifts WHERE id='{uid(17)}';")
    # cycle0割当の削除自体が全体日報を対象外にするため、旧日報の互換は別途既存行で作る。
    seed()
    sql(f"ALTER TABLE daily_reports_v2 DISABLE TRIGGER guard_report_current_shift; DELETE FROM daily_reports_v2 WHERE id IN ('{uid(20)}','{uid(21)}'); INSERT INTO daily_reports_v2(id,org_id,driver_id,report_date,course_id,cycle_no,approved_at) VALUES('{uid(27)}','{org}','{driver}','2026-10-16','{course}',0,now()); ALTER TABLE daily_reports_v2 ENABLE TRIGGER guard_report_current_shift;")
    expect(f"SELECT admin_daily_unread_count('{org}','2026-10-16','2026-10-16');", '0')
    sql(f"UPDATE daily_reports_v2 SET submitted_at=clock_timestamp() WHERE id='{uid(27)}';")
    sql(f"DELETE FROM shifts WHERE id='{uid(11)}';")
    expect(f"SELECT rejection_reason FROM daily_reports_v2 WHERE id='{uid(27)}';", 'shift_changed')
    seed()
    denied(f"BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE daily_reports_v2 SET submitted_at=clock_timestamp() WHERE id='{uid(20)}'; COMMIT;")
    denied(f"BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE shifts SET driver_id=NULL WHERE id='{uid(10)}'; COMMIT;")
    sql(f"SET ROLE service_role; UPDATE shifts SET driver_id=NULL WHERE id='{uid(10)}';")
    expect(f"SELECT rejected_at IS NOT NULL AND approved_at IS NULL AND rejected_by IS NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    expect("SELECT count(*) FROM daily_reports_v2 WHERE rejected_at IS NULL;", '4')
    expect(f"SELECT rate_snapshot->>'fixed' FROM daily_reports_v2 WHERE id='{uid(20)}';", '10000')
    expect(f"SELECT value_num FROM report_entries WHERE report_id='{uid(20)}';", '123')
    denied(f"UPDATE daily_reports_v2 SET approved_at=now(),rejected_at=NULL WHERE id='{uid(20)}';")
    denied(f"UPDATE daily_reports_v2 SET submitted_at=clock_timestamp(),rejected_at=NULL WHERE id='{uid(20)}';")
    sql(f"UPDATE shifts SET driver_id='{driver}' WHERE id='{uid(10)}';")
    expect(f"SELECT rejected_at IS NOT NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    sql(f"INSERT INTO daily_reports_v2(id,org_id,driver_id,report_date,course_id,cycle_no) VALUES('{uid(25)}','{org}','{driver}','2026-10-16','{course}',1);")
    expect(f"SELECT approved_at IS NULL AND rejected_at IS NULL FROM daily_reports_v2 WHERE id='{uid(25)}';", 't')
    sql(f"UPDATE daily_reports_v2 SET approved_at=now() WHERE id='{uid(25)}';")

    seed()
    sql(f"UPDATE shifts SET vehicle_id='{uid(100)}',meeting_time='09:00' WHERE id='{uid(10)}';")
    expect(f"SELECT approved_at IS NOT NULL AND rejected_at IS NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    sql(f"BEGIN; DELETE FROM shifts WHERE id='{uid(10)}'; INSERT INTO shifts(id,org_id,driver_id,shift_date,course_id,cycle_no,slot) VALUES('{uid(15)}','{org}','{driver}','2026-10-16','{course}',1,3); COMMIT;")
    expect(f"SELECT rejected_at IS NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    sql(f"INSERT INTO shifts(id,org_id,driver_id,shift_date,course_id,cycle_no,slot) VALUES('{uid(16)}','{org}','{driver}','2026-10-16','{course}',1,4); DELETE FROM shifts WHERE id='{uid(15)}';")
    expect(f"SELECT rejected_at IS NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    sql(f"DELETE FROM shifts WHERE id='{uid(16)}';")
    expect(f"SELECT rejected_at IS NOT NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')

    seed()
    sql(f"BEGIN; UPDATE shifts SET driver_id=NULL WHERE id='{uid(10)}'; ROLLBACK;")
    expect(f"SELECT rejected_at IS NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    sql(f"UPDATE shifts SET driver_id='{peer}' WHERE id='{uid(10)}';")
    expect(f"SELECT rejected_at IS NOT NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    expect(f"SELECT rejected_at IS NULL FROM daily_reports_v2 WHERE id='{uid(22)}';", 't')

    seed()
    sql(f"DELETE FROM shifts WHERE course_id='{course}' AND shift_date='2026-10-16';")
    expect("SELECT count(*) FROM daily_reports_v2 WHERE rejected_at IS NOT NULL;", '3')
    # reportContributions/buildContributions が参照する既存の承認・却下条件で除外。
    expect("SELECT count(*) FROM daily_reports_v2 WHERE approved_at IS NOT NULL AND rejected_at IS NULL;", '2')
    denied(f"INSERT INTO daily_reports_v2(id,org_id,driver_id,report_date,course_id,cycle_no) VALUES('{uid(30)}','{org}','{driver}','2026-10-16','{course}',1);")

    seed()
    sql(f"UPDATE shifts SET shift_date='2026-10-17' WHERE id='{uid(10)}';")
    expect(f"SELECT rejected_at IS NOT NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    seed()
    sql(f"UPDATE daily_reports_v2 SET approved_at=NULL,rejected_at='2026-10-16 01:00Z',rejected_by='{peer}' WHERE id='{uid(20)}'; UPDATE shifts SET driver_id=NULL WHERE id='{uid(10)}';")
    expect(f"SELECT rejected_by::text FROM daily_reports_v2 WHERE id='{uid(20)}';", peer)

    # RLS を有効にした環境でも、シフト書込者に日報権限を広げず連動。
    seed()
    sql('''ALTER TABLE courses ENABLE ROW LEVEL SECURITY; ALTER TABLE courses FORCE ROW LEVEL SECURITY;
    ALTER TABLE shifts ENABLE ROW LEVEL SECURITY; ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
    ALTER TABLE daily_reports_v2 ENABLE ROW LEVEL SECURITY; ALTER TABLE daily_reports_v2 FORCE ROW LEVEL SECURITY;
    CREATE ROLE fixture_shift_writer; GRANT USAGE ON SCHEMA public TO fixture_shift_writer;
    GRANT SELECT, UPDATE, DELETE ON shifts TO fixture_shift_writer;
    CREATE POLICY fixture_shift_write ON shifts TO fixture_shift_writer USING(true) WITH CHECK(true);''')
    sql(f"SET ROLE fixture_shift_writer; UPDATE shifts SET driver_id=NULL WHERE id='{uid(10)}';")
    expect(f"SELECT rejected_at IS NOT NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    denied(f"SET ROLE fixture_shift_writer; UPDATE daily_reports_v2 SET approved_at=now();")
    expect("SELECT has_function_privilege('anon','public.reject_reports_for_removed_shift()','execute');", 'f')
    expect("SELECT has_function_privilege('service_role','public.guard_report_current_shift()','execute');", 'f')
    # SECURITY DEFINER は専用NOLOGINロール・固定search_path、一般APIから呼べない。
    expect("SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='hakotora_shift_report_sync' AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog'];", '3')

    # 日報送信が先にロックを取った場合、解除側が送信完了を待って確実に除外。
    seed()
    writer = subprocess.Popen(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    writer.stdin.write(f"BEGIN; UPDATE daily_reports_v2 SET submitted_at=clock_timestamp() WHERE id='{uid(20)}'; SELECT 'locked'; SELECT pg_sleep(1); COMMIT;\n")
    writer.stdin.close()
    assert writer.stdout.readline().strip() == 'locked'
    sql(f"UPDATE shifts SET driver_id=NULL WHERE id='{uid(10)}';")
    assert writer.wait(timeout=10) == 0, writer.stderr.read()
    expect(f"SELECT rejected_at IS NOT NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    # 解除が先なら新規・既存の送信とも待たずに拒否し、行ロックの相互待ちを防ぐ。
    seed()
    remover = subprocess.Popen(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    remover.stdin.write(f"BEGIN; UPDATE shifts SET driver_id=NULL WHERE id='{uid(10)}'; SELECT 'locked'; SELECT pg_sleep(1); COMMIT;\n")
    remover.stdin.close()
    assert remover.stdout.readline().strip() == 'locked'
    denied(f"INSERT INTO daily_reports_v2(id,org_id,driver_id,report_date,course_id,cycle_no) VALUES('{uid(30)}','{org}','{driver}','2026-10-16','{course}',1);")
    denied(f"UPDATE daily_reports_v2 SET submitted_at=clock_timestamp() WHERE id='{uid(20)}';")
    assert remover.wait(timeout=10) == 0, remover.stderr.read()
    expect(f"SELECT rejected_at IS NOT NULL FROM daily_reports_v2 WHERE id='{uid(20)}';", 't')
    print('PASS: removal, reassignment, cycles, peers, dates, tenants, history, resubmission, approval, slot move, duplicate slots, rollback, import deletion, RLS, ACL, both submission/removal race orders')
finally:
    run(['docker', 'rm', '--force', container])
