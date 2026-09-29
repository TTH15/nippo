"""Exercise migration 186 in an isolated PostgreSQL 17 container."""

from pathlib import Path
import subprocess
import time
import uuid


container = "hakotora-tenant-" + uuid.uuid4().hex[:8]
image = "postgres:17"
schema = """
CREATE TABLE organizations(id uuid PRIMARY KEY);
CREATE TABLE drivers(id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id));
CREATE TABLE courses(id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id));
CREATE TABLE driver_identities(id uuid PRIMARY KEY, driver_id uuid NOT NULL REFERENCES drivers(id));
CREATE TABLE driver_courses(id uuid PRIMARY KEY, driver_id uuid NOT NULL REFERENCES drivers(id),
  driver_identity_id uuid NOT NULL REFERENCES driver_identities(id),
  course_id uuid NOT NULL REFERENCES courses(id), org_id uuid REFERENCES organizations(id));
INSERT INTO organizations VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO drivers VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
INSERT INTO courses VALUES ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
INSERT INTO driver_identities VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO driver_courses VALUES ('40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',NULL);
"""


def query(sql: str, *, succeeds: bool = True) -> str:
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1", "-At"],
        input=sql, text=True, capture_output=True, check=False,
    )
    if (result.returncode == 0) != succeeds:
        raise AssertionError(f"Unexpected PostgreSQL result: {result.stderr[-500:]}")
    return result.stdout.strip()


subprocess.run(
    ["docker", "run", "--rm", "-d", "--network", "none", "--name", container,
     "-e", "POSTGRES_PASSWORD=local-test-only", image],
    check=True, stdout=subprocess.DEVNULL,
)
try:
    for _ in range(50):
        try:
            if query("SELECT 1") == "1":
                break
        except AssertionError:
            time.sleep(0.2)
    else:
        raise RuntimeError("Local PostgreSQL did not start")

    query(schema)
    migration = Path(__file__).resolve().parents[3] / "supabase/migrations/186_driver_courses_tenant_guard.sql"
    query(migration.read_text())
    assert query("SELECT count(*) FROM driver_courses WHERE org_id IS NULL") == "0"
    query("""INSERT INTO driver_courses VALUES ('40000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',NULL)""", succeeds=False)
    query("""UPDATE drivers SET org_id='00000000-0000-0000-0000-000000000002'
      WHERE id='10000000-0000-0000-0000-000000000001'""", succeeds=False)
    query("""UPDATE courses SET org_id='00000000-0000-0000-0000-000000000002'
      WHERE id='20000000-0000-0000-0000-000000000001'""", succeeds=False)
    query("""UPDATE driver_identities SET driver_id='10000000-0000-0000-0000-000000000002'
      WHERE id='30000000-0000-0000-0000-000000000001'""", succeeds=False)
    assert query("SELECT count(*) FROM driver_courses") == "1"
    print("migration 186: backfill, cross-org insert, and three parent move guards passed")
finally:
    subprocess.run(["docker", "stop", container], check=True, stdout=subprocess.DEVNULL)
