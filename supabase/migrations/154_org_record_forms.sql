-- 記録・報告の汎用フォーム。153 の固定案件・支払テーブルには依存しない。
-- 本番ではこのファイルだけをトランザクション内で適用する。サンプル・既存記録の移行なし。
CREATE TABLE IF NOT EXISTS org_record_forms (
 org_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), definition jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES drivers(id), updated_by uuid NOT NULL REFERENCES drivers(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,id), CHECK(jsonb_typeof(definition)='object')
);
CREATE TABLE IF NOT EXISTS org_record_form_versions (
 org_id uuid NOT NULL, form_id uuid NOT NULL, version integer NOT NULL,
 definition jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES drivers(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,form_id,version), FOREIGN KEY(org_id,form_id) REFERENCES org_record_forms(org_id,id)
);
CREATE TABLE IF NOT EXISTS org_records (
 org_id uuid NOT NULL, form_id uuid NOT NULL, id uuid NOT NULL,
 form_version integer NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 answers jsonb NOT NULL, status text NOT NULL DEFAULT '' CHECK(status IN ('','open','progress','resolved')),
 author_id uuid NOT NULL REFERENCES drivers(id), reporter_id uuid NOT NULL REFERENCES drivers(id), subject_id uuid REFERENCES drivers(id),
 member_names jsonb NOT NULL DEFAULT '{}', record_date date, search_text text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,form_id,id), FOREIGN KEY(org_id,form_id,form_version) REFERENCES org_record_form_versions(org_id,form_id,version)
);
CREATE INDEX IF NOT EXISTS org_records_list ON org_records(org_id,form_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS org_records_author ON org_records(org_id,form_id,author_id);
CREATE INDEX IF NOT EXISTS org_records_subject ON org_records(org_id,form_id,subject_id);
CREATE INDEX IF NOT EXISTS org_records_date ON org_records(org_id,form_id,record_date);
CREATE TABLE IF NOT EXISTS org_record_events (
 org_id uuid NOT NULL, form_id uuid NOT NULL, record_id uuid NOT NULL, version integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES drivers(id), actor_name text NOT NULL, text text NOT NULL, internal boolean NOT NULL DEFAULT false,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,form_id,record_id,version), FOREIGN KEY(org_id,form_id,record_id) REFERENCES org_records(org_id,form_id,id)
);
-- RLS に依存せず、サーバーの認証・orgスコープと service_role 専用 RPC で制限する。
REVOKE ALL ON org_record_forms,org_record_form_versions,org_records,org_record_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON org_record_forms,org_record_form_versions,org_records,org_record_events TO service_role;

CREATE OR REPLACE FUNCTION org_record_is_manager(p_org uuid,p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM drivers d JOIN organizations o ON o.id=d.org_id
 WHERE d.id=p_actor AND d.org_id=p_org AND d.status='active' AND o.status='active'
 AND ((d.role_id IS NULL AND d.role='ADMIN') OR EXISTS(SELECT 1 FROM roles r JOIN role_capabilities c ON c.role_id=r.id
 WHERE r.id=d.role_id AND r.org_id=p_org AND c.capability IN ('can_manage_record_forms','can_manage_org_settings'))));
$$;

CREATE OR REPLACE FUNCTION save_org_record_form(p_org uuid,p_actor uuid,p_id uuid,p_expected integer,p_definition jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE current_version integer; next_version integer;
BEGIN
 IF NOT org_record_is_manager(p_org,p_actor) THEN RAISE EXCEPTION 'record_forbidden'; END IF;
 -- ロールIDを別orgから持ち込めないようDB境界でも確認。
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_definition->'access') AS a(id)
 WHERE NOT EXISTS(SELECT 1 FROM roles r WHERE r.id::text=a.id AND r.org_id=p_org)) THEN RAISE EXCEPTION 'record_forbidden'; END IF;
 SELECT version INTO current_version FROM org_record_forms WHERE org_id=p_org AND id=p_id FOR UPDATE;
 IF p_expected=0 THEN
  IF current_version IS NOT NULL THEN RAISE EXCEPTION 'record_conflict'; END IF;
  next_version:=1;
  INSERT INTO org_record_forms(org_id,id,version,definition,created_by,updated_by) VALUES(p_org,p_id,1,p_definition,p_actor,p_actor);
 ELSE
  IF current_version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'record_conflict'; END IF;
  next_version:=current_version+1;
  UPDATE org_record_forms SET version=next_version,definition=p_definition,updated_by=p_actor,updated_at=now() WHERE org_id=p_org AND id=p_id;
 END IF;
 IF (p_definition->>'id') IS DISTINCT FROM p_id::text OR (p_definition->>'version')::integer IS DISTINCT FROM next_version THEN RAISE EXCEPTION 'record_conflict'; END IF;
 INSERT INTO org_record_form_versions(org_id,form_id,version,definition,actor_id) VALUES(p_org,p_id,next_version,p_definition,p_actor);
 -- 画面への入口だけを付与。各記録へのアクセスは毎回フォームの権限で再判定する。
 INSERT INTO role_capabilities(role_id,capability)
 SELECT r.id,'can_access_records' FROM roles r WHERE r.org_id=p_org AND p_definition->'access'->>r.id::text IN ('view','edit') ON CONFLICT DO NOTHING;
 RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION save_org_record(p_org uuid,p_actor uuid,p_form uuid,p_id uuid,p_form_version integer,p_expected integer,p_scope text,p_payload jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE f org_record_forms%ROWTYPE; old org_records%ROWTYPE; d drivers%ROWTYPE; schema jsonb;
 is_manager boolean; access_level text; allowed boolean; next_version integer; is_note boolean; a jsonb; reporter uuid; subject uuid; names jsonb; s text; actor_label text;
BEGIN
 IF p_scope NOT IN ('staff','self') THEN RAISE EXCEPTION 'record_forbidden'; END IF;
 SELECT * INTO d FROM drivers WHERE id=p_actor AND org_id=p_org AND status='active' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM organizations WHERE id=p_org AND status='active') THEN RAISE EXCEPTION 'record_forbidden'; END IF;
 SELECT * INTO f FROM org_record_forms WHERE org_id=p_org AND id=p_form FOR SHARE;
 IF NOT FOUND OR f.version IS DISTINCT FROM p_form_version THEN RAISE EXCEPTION 'record_conflict'; END IF;
 is_manager:=org_record_is_manager(p_org,p_actor);
 access_level:=CASE WHEN is_manager THEN 'edit' ELSE COALESCE(f.definition->'access'->>d.role_id::text,'none') END;
 SELECT * INTO old FROM org_records WHERE org_id=p_org AND form_id=p_form AND id=p_id FOR UPDATE;
 IF p_expected=0 THEN
  IF old.id IS NOT NULL THEN RAISE EXCEPTION 'record_conflict'; END IF;
  allowed:=CASE WHEN p_scope='staff' THEN access_level='edit' ELSE (d.works_as_driver OR d.role='DRIVER') AND (f.definition->'driver'->>'submit')::boolean END;
  schema:=f.definition; next_version:=1;
 ELSE
  IF old.id IS NULL OR old.version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'record_conflict'; END IF;
  allowed:=CASE WHEN p_scope='staff' THEN access_level='edit' ELSE (d.works_as_driver OR d.role='DRIVER') AND old.author_id=p_actor AND (f.definition->'driver'->>'readOwn')::boolean AND (f.definition->'driver'->>'editOwn')::boolean END;
  SELECT definition INTO schema FROM org_record_form_versions WHERE org_id=p_org AND form_id=p_form AND version=old.form_version;
  next_version:=old.version+1;
 END IF;
 IF NOT COALESCE(allowed,false) THEN RAISE EXCEPTION 'record_forbidden'; END IF;
 is_note:=COALESCE((p_payload->>'internal')::boolean,false);
 IF is_note AND (p_scope<>'staff' OR p_expected=0) THEN RAISE EXCEPTION 'record_forbidden'; END IF;
 IF p_expected>0 AND length(trim(COALESCE(p_payload->>'note','')))=0 THEN RAISE EXCEPTION 'record_invalid'; END IF;
 actor_label:=d.name;
 IF NOT is_note THEN
  a:=p_payload->'answers'; reporter:=(p_payload->>'reporter')::uuid; names:=p_payload->'memberNames'; s:=p_payload->>'status';
  subject:=NULLIF(a->>(schema->>'subjectField'),'')::uuid;
  IF NOT EXISTS(SELECT 1 FROM drivers WHERE id=reporter AND org_id=p_org) OR (subject IS NOT NULL AND NOT EXISTS(SELECT 1 FROM drivers WHERE id=subject AND org_id=p_org)) THEN RAISE EXCEPTION 'record_forbidden'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(names) n(id) WHERE NOT EXISTS(SELECT 1 FROM drivers WHERE id::text=n.id AND org_id=p_org)) THEN RAISE EXCEPTION 'record_forbidden'; END IF;
  IF p_scope='self' AND (reporter IS DISTINCT FROM CASE WHEN p_expected=0 THEN p_actor ELSE old.reporter_id END OR s IS DISTINCT FROM CASE WHEN p_expected=0 THEN COALESCE(schema->'statuses'->0->>'id','') ELSE old.status END) THEN RAISE EXCEPTION 'record_forbidden'; END IF;
  IF s<>'' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(schema->'statuses') t WHERE t->>'id'=s) THEN RAISE EXCEPTION 'record_invalid'; END IF;
  IF s='' AND jsonb_array_length(schema->'statuses')>0 THEN RAISE EXCEPTION 'record_invalid'; END IF;
  IF p_expected=0 THEN
   INSERT INTO org_records(org_id,form_id,id,form_version,answers,status,author_id,reporter_id,subject_id,member_names,record_date,search_text)
   VALUES(p_org,p_form,p_id,f.version,a,s,p_actor,reporter,subject,names,NULLIF(a->>(schema->>'dateField'),'')::date,p_payload->>'searchText');
  ELSE
   UPDATE org_records SET answers=a,status=s,reporter_id=reporter,subject_id=subject,member_names=names,record_date=NULLIF(a->>(schema->>'dateField'),'')::date,search_text=p_payload->>'searchText',version=next_version,updated_at=now() WHERE org_id=p_org AND form_id=p_form AND id=p_id;
  END IF;
 ELSE
  UPDATE org_records SET version=next_version,updated_at=now() WHERE org_id=p_org AND form_id=p_form AND id=p_id;
 END IF;
 INSERT INTO org_record_events(org_id,form_id,record_id,version,actor_id,actor_name,text,internal,snapshot)
 SELECT p_org,p_form,p_id,next_version,p_actor,actor_label,COALESCE(p_payload->>'note','記録を作成'),is_note,
 jsonb_build_object('answers',answers,'status',status,'reporter',reporter_id,'formVersion',form_version)
 FROM org_records WHERE org_id=p_org AND form_id=p_form AND id=p_id;
 RETURN next_version;
END;
$$;
REVOKE ALL ON FUNCTION org_record_is_manager(uuid,uuid),save_org_record_form(uuid,uuid,uuid,integer,jsonb),save_org_record(uuid,uuid,uuid,uuid,integer,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION org_record_is_manager(uuid,uuid),save_org_record_form(uuid,uuid,uuid,integer,jsonb),save_org_record(uuid,uuid,uuid,uuid,integer,integer,text,jsonb) TO service_role;
