-- 案件と日払いの独立した記録。会計テーブルには書き込まない。
CREATE TABLE response_records (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('cases', 'daily-payments')),
  record_date date NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  search_text text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  actor_id uuid NOT NULL REFERENCES drivers(id),
  actor_name text NOT NULL,
  change_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  CHECK ((kind = 'cases' AND status IN ('未対応', '対応中', '解決済み', '取消'))
    OR (kind = 'daily-payments' AND status IN ('支払済み', '取消')))
);
CREATE INDEX response_records_org_kind_date ON response_records (org_id, kind, record_date DESC, id);
CREATE TABLE response_record_revisions (
  org_id uuid NOT NULL,
  record_id uuid NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES drivers(id),
  actor_name text NOT NULL,
  change_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_id, version),
  FOREIGN KEY (org_id, record_id) REFERENCES response_records(org_id, id)
);
-- RLS不使用のAPI専用テーブル。ブラウザのanon/authenticatedから直接アクセスさせない。
REVOKE ALL ON response_records, response_record_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON response_records TO service_role;
GRANT SELECT, INSERT ON response_record_revisions TO service_role;

CREATE FUNCTION validate_response_record() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id <> OLD.org_id OR NEW.kind <> OLD.kind OR NEW.id <> OLD.id
      OR NEW.version <> OLD.version + 1 OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Invalid record revision';
    END IF;
  ELSIF NEW.version <> 1 THEN
    RAISE EXCEPTION 'Invalid initial revision';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM drivers WHERE id = NEW.actor_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Invalid record actor';
  END IF;
  IF NEW.data->>'subjectId' IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM drivers WHERE id = (NEW.data->>'subjectId')::uuid AND org_id = NEW.org_id
  ) THEN RAISE EXCEPTION 'Invalid record subject'; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER response_record_validate BEFORE INSERT OR UPDATE ON response_records
  FOR EACH ROW EXECUTE FUNCTION validate_response_record();
CREATE FUNCTION save_response_record_revision() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO response_record_revisions (org_id, record_id, version, snapshot, actor_id, actor_name, change_note, created_at)
  VALUES (NEW.org_id, NEW.id, NEW.version, NEW.data, NEW.actor_id, NEW.actor_name, NEW.change_note, NEW.updated_at);
  RETURN NEW;
END $$;
CREATE TRIGGER response_record_revision AFTER INSERT OR UPDATE ON response_records
  FOR EACH ROW EXECUTE FUNCTION save_response_record_revision();
REVOKE ALL ON FUNCTION validate_response_record(), save_response_record_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION validate_response_record(), save_response_record_revision() TO service_role;

-- 初期付与は管理者のみ。他のロールへの付与はロール設定で明示的に行う。
INSERT INTO role_capabilities (role_id, capability)
SELECT r.id, c.capability FROM roles r
CROSS JOIN (VALUES ('can_view_cases'), ('can_manage_cases'), ('can_view_daily_payments'), ('can_manage_daily_payments')) c(capability)
WHERE r.is_system = true AND r.key = 'ADMIN'
ON CONFLICT DO NOTHING;
