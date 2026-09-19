-- 専用のネットワークなしテストコンテナのみ。既存DB・本番には実行しない。
DO $$ BEGIN IF current_database()<>'hakotora_memo_test' THEN RAISE EXCEPTION 'Dedicated test database required'; END IF; END $$;
CREATE TABLE organizations(id uuid PRIMARY KEY);
CREATE TABLE drivers(id uuid PRIMARY KEY, org_id uuid REFERENCES organizations, name text, status text DEFAULT 'active', works_as_driver boolean DEFAULT true);
CREATE TABLE courses(id uuid PRIMARY KEY, org_id uuid REFERENCES organizations, name text, uses_cycles boolean DEFAULT false, archived_at timestamptz, slot_id uuid);
CREATE TABLE course_cycles(course_id uuid REFERENCES courses, cycle_no int, active boolean DEFAULT true, PRIMARY KEY(course_id,cycle_no));
CREATE TABLE shifts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_date date NOT NULL, course_id uuid NOT NULL REFERENCES courses, cycle_no int NOT NULL DEFAULT 0,
  slot int NOT NULL DEFAULT 1, driver_id uuid REFERENCES drivers, vehicle_id uuid, uses_external_vehicle boolean DEFAULT false,
  meeting_place text, meeting_time time, arrival_time time, end_time time, import_batch_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(shift_date,course_id,cycle_no,slot));
CREATE TABLE shift_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid REFERENCES drivers, request_date date, slot_id uuid);
CREATE TABLE shift_change_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid, actor_driver_id uuid, action text, shift_date date, course_id uuid, cycle_no int, slot int, before jsonb, after jsonb);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
