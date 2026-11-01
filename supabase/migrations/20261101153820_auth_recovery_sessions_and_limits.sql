-- 認証の失効・復旧・SMS予算。service_roleからのみ実行する。
SET LOCAL lock_timeout = '3s';
CREATE TABLE public.auth_session_revocations (
 session_id text PRIMARY KEY CHECK(session_id ~ '^[0-9a-f-]{36}$|^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_session_revocations_expiry ON public.auth_session_revocations(expires_at);
CREATE TABLE public.auth_request_budgets (
 bucket text PRIMARY KEY, hits integer NOT NULL CHECK(hits>0), expires_at timestamptz NOT NULL
);
CREATE INDEX auth_request_budgets_expiry ON public.auth_request_budgets(expires_at);
CREATE TABLE public.account_recovery_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id),
 driver_id uuid NOT NULL REFERENCES public.drivers(id), identity_id uuid NOT NULL REFERENCES public.identities(id),
 token_version integer NOT NULL, session_hash text NOT NULL CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 approved_by uuid REFERENCES public.identities(id), approved_at timestamptz, used_at timestamptz,
 UNIQUE(driver_id, session_hash)
);
ALTER TABLE public.auth_session_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_request_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_recovery_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_session_revocations,public.auth_request_budgets,public.account_recovery_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.auth_session_revocations,public.auth_request_budgets,public.account_recovery_requests TO service_role;

CREATE FUNCTION public.auth_session_is_revoked(p_session_id text,p_parent_session_id text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.auth_session_revocations WHERE session_id IN (p_session_id,p_parent_session_id) AND expires_at>now());
$$;

CREATE FUNCTION public.revoke_auth_sessions(p_driver_id uuid,p_identity_id uuid,p_org_id uuid,p_version integer,
 p_sessions jsonb DEFAULT '[]',p_all boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; notice uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||p_identity_id::text,0));
 PERFORM 1 FROM public.drivers WHERE id=p_driver_id AND identity_id=p_identity_id AND org_id=p_org_id AND token_version=p_version AND status IN ('active','pending') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'membership mismatch' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_sessions)<>'array' OR jsonb_array_length(p_sessions)>2 THEN RAISE EXCEPTION 'invalid sessions' USING ERRCODE='22023';END IF;
 IF p_all THEN
  PERFORM 1 FROM public.identities WHERE id=p_identity_id FOR UPDATE;
  UPDATE public.drivers SET token_version=token_version+1 WHERE identity_id=p_identity_id;
  INSERT INTO public.notifications(org_id,driver_id,identity_id,kind,title,body,payload)
   VALUES(p_org_id,p_driver_id,p_identity_id,'account_security','すべての端末からログアウトしました','心当たりがない場合は運営へ連絡してください。','{"action":"revoke_sessions"}') RETURNING id INTO notice;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_sessions) LOOP
  IF item->>'id' !~ '^[0-9a-f-]{36}$|^[0-9a-f]{64}$' OR item->>'id' IS NULL OR item->>'expiresAt' IS NULL THEN RAISE EXCEPTION 'invalid session' USING ERRCODE='22023';END IF;
  INSERT INTO public.auth_session_revocations(session_id,expires_at) VALUES(item->>'id',least((item->>'expiresAt')::timestamptz,now()+interval '30 days'))
   ON CONFLICT(session_id) DO UPDATE SET expires_at=greatest(auth_session_revocations.expires_at,EXCLUDED.expires_at);
 END LOOP;
 DELETE FROM public.auth_session_revocations WHERE session_id IN (SELECT session_id FROM public.auth_session_revocations WHERE expires_at<=now() LIMIT 100);
 RETURN jsonb_build_object('ok',true,'notificationId',notice);
END;
$$;

-- 1回の送信・照合で全体予算と対象ごとの予算を原子的に消費する。
CREATE FUNCTION public.consume_auth_request_budget(p_kind text,p_subject text,p_ip text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE now_at timestamptz:=clock_timestamp(); window_seconds integer; max_hits integer; spec record; count_hits integer;
BEGIN
 IF p_kind NOT IN ('sms-send','sms-check') OR p_kind IS NULL OR p_subject !~ '^[a-f0-9]{64}$' OR p_subject IS NULL OR (p_ip IS NOT NULL AND p_ip !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'invalid limit' USING ERRCODE='22023';END IF;
 -- 拒否時は部分消費も戻し、同じ番号への再試行で全体の日次予算を使い切らせない。
 BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('global-day',86400,CASE WHEN p_kind='sms-send' THEN 500 ELSE 5000 END,''),
  ('subject-minute',60,CASE WHEN p_kind='sms-send' THEN 1 ELSE 5 END,p_subject),
  ('subject-day',86400,CASE WHEN p_kind='sms-send' THEN 10 ELSE 100 END,p_subject),
  ('ip-minute',60,CASE WHEN p_kind='sms-send' THEN 10 ELSE 30 END,p_ip)
 ) AS limits(scope,seconds,maximum,subject) ORDER BY scope LOOP
  IF spec.subject IS NULL THEN CONTINUE;END IF;
  INSERT INTO public.auth_request_budgets AS b(bucket,hits,expires_at)
   VALUES(p_kind||':'||spec.scope||':'||spec.subject,1,now_at+make_interval(secs=>spec.seconds))
   ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN b.expires_at<=now_at THEN 1 ELSE b.hits+1 END,
    expires_at=CASE WHEN b.expires_at<=now_at THEN EXCLUDED.expires_at ELSE b.expires_at END RETURNING hits INTO count_hits;
  IF count_hits>spec.maximum THEN RAISE EXCEPTION 'auth budget exceeded';END IF;
 END LOOP;
 EXCEPTION WHEN raise_exception THEN RETURN false;
 END;
 DELETE FROM public.auth_request_budgets WHERE bucket IN (SELECT bucket FROM public.auth_request_budgets WHERE expires_at<=now_at LIMIT 100);
 RETURN true;
END;
$$;

CREATE FUNCTION public.request_account_recovery(p_driver_id uuid,p_identity_id uuid,p_org_id uuid,p_version integer,p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.account_recovery_requests; notice uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||p_identity_id::text,0));
 PERFORM 1 FROM public.drivers d JOIN public.identities i ON i.id=d.identity_id
  WHERE d.id=p_driver_id AND d.identity_id=p_identity_id AND d.org_id=p_org_id AND d.status='active' AND d.token_version=p_version AND i.phone_verified_at IS NOT NULL FOR SHARE OF d;
 IF NOT FOUND THEN RAISE EXCEPTION 'membership mismatch' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.account_recovery_requests WHERE driver_id=p_driver_id AND session_hash=p_session_hash FOR UPDATE;
 IF FOUND AND r.expires_at>now() AND r.status IN ('pending','approved') AND r.token_version=p_version THEN
  RETURN jsonb_build_object('id',r.id,'status',r.status,'expiresAt',r.expires_at);
 END IF;
 INSERT INTO public.account_recovery_requests(driver_id,identity_id,org_id,token_version,session_hash)
 VALUES(p_driver_id,p_identity_id,p_org_id,p_version,p_session_hash)
 ON CONFLICT(driver_id,session_hash) DO UPDATE SET id=gen_random_uuid(),token_version=p_version,status='pending',created_at=now(),expires_at=now()+interval '24 hours',approved_by=NULL,approved_at=NULL,used_at=NULL
 RETURNING * INTO r;
 INSERT INTO public.notifications(org_id,driver_id,identity_id,kind,title,body,payload)
 VALUES(p_org_id,p_driver_id,p_identity_id,'account_security','パスキーの復旧申請を受け付けました','心当たりがない場合は運営へ連絡してください。',jsonb_build_object('action','request_recovery','requestId',r.id)) RETURNING id INTO notice;
 RETURN jsonb_build_object('id',r.id,'status',r.status,'expiresAt',r.expires_at,'notificationId',notice);
END;
$$;

CREATE FUNCTION public.decide_account_recovery(p_request_id uuid,p_actor_driver_id uuid,p_actor_identity_id uuid,p_actor_org_id uuid,p_actor_version integer,p_approve boolean,p_platform boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.account_recovery_requests; notice uuid; target_identity uuid;
BEGIN
 SELECT identity_id INTO target_identity FROM public.account_recovery_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'request unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||target_identity::text,0));
 SELECT * INTO r FROM public.account_recovery_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.expires_at<=now() THEN RAISE EXCEPTION 'request unavailable' USING ERRCODE='P0002';END IF;
 IF r.identity_id=p_actor_identity_id THEN RAISE EXCEPTION 'self approval denied' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.drivers WHERE id=p_actor_driver_id AND identity_id=p_actor_identity_id AND org_id=p_actor_org_id AND token_version=p_actor_version AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'actor mismatch' USING ERRCODE='42501';END IF;
 IF p_platform THEN
  IF NOT EXISTS(SELECT 1 FROM public.platform_admins WHERE identity_id=p_actor_identity_id) THEN RAISE EXCEPTION 'platform approval denied' USING ERRCODE='42501';END IF;
 ELSE
  IF r.org_id<>p_actor_org_id OR NOT EXISTS(SELECT 1 FROM public.drivers d JOIN public.roles role ON role.id=d.role_id AND role.org_id=d.org_id
   WHERE d.id=p_actor_driver_id AND role.is_system AND role.key='ADMIN') THEN RAISE EXCEPTION 'admin approval denied' USING ERRCODE='42501';END IF;
 END IF;
 PERFORM 1 FROM public.drivers WHERE id=r.driver_id AND identity_id=r.identity_id AND org_id=r.org_id AND token_version=r.token_version AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'target changed' USING ERRCODE='42501';END IF;
 UPDATE public.account_recovery_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
  approved_by=p_actor_identity_id,approved_at=now(),expires_at=CASE WHEN p_approve THEN now()+interval '15 minutes' ELSE expires_at END WHERE id=r.id;
 INSERT INTO public.notifications(org_id,driver_id,identity_id,kind,title,body,payload)
 VALUES(r.org_id,r.driver_id,r.identity_id,'account_security',CASE WHEN p_approve THEN 'パスキーの復旧が承認されました' ELSE 'パスキーの復旧は承認されませんでした' END,
 CASE WHEN p_approve THEN '15分以内に申請した画面でパスキーを追加してください。' ELSE '管理者または運営窓口へ確認してください。' END,jsonb_build_object('action','decide_recovery','requestId',r.id)) RETURNING id INTO notice;
 INSERT INTO public.platform_audit_logs(actor_identity_id,action,target,detail) VALUES(p_actor_identity_id,'account_recovery_decision',r.id::text,jsonb_build_object('approved',p_approve,'platform',p_platform,'orgId',r.org_id));
 RETURN jsonb_build_object('ok',true,'notificationId',notice,'orgId',r.org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_passkey(
  p_driver_id uuid, p_identity_id uuid, p_org_id uuid,
  p_operation text, p_credential jsonb DEFAULT NULL, p_key_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_phone text; v_verified timestamptz; v_key_id uuid;
  v_notification_id uuid; v_title text; v_count integer;
BEGIN
  IF p_operation NOT IN ('register', 'delete') OR p_operation IS NULL THEN
    RAISE EXCEPTION 'invalid operation' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||p_identity_id::text,0));
  PERFORM 1 FROM public.drivers WHERE id=p_driver_id AND identity_id=p_identity_id
    AND org_id=p_org_id AND status IN ('active', 'pending') FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership mismatch' USING ERRCODE = '42501';
  END IF;
  -- 同一人物の並行削除を直列化し、最後の鍵を同時に消せないようにする。
  SELECT phone, phone_verified_at INTO v_phone, v_verified FROM public.identities WHERE id=p_identity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'identity not found' USING ERRCODE='P0002'; END IF;

  IF p_operation = 'register' THEN
    IF p_credential IS NULL OR COALESCE(p_credential->>'credential_id', '') = ''
      OR COALESCE(p_credential->>'public_key', '') !~ '^\\x[0-9a-f]+$' THEN
      RAISE EXCEPTION 'invalid credential' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.passkey_credentials(identity_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
    VALUES (p_identity_id, p_credential->>'credential_id', (p_credential->>'public_key')::bytea,
      (p_credential->>'counter')::bigint,
      CASE WHEN jsonb_typeof(p_credential->'transports')='array' THEN ARRAY(SELECT jsonb_array_elements_text(p_credential->'transports')) ELSE NULL END,
      p_credential->>'device_type', (p_credential->>'backed_up')::boolean, p_credential->>'name') RETURNING id INTO v_key_id;
    v_title := 'Passkeyが登録されました';
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.passkey_credentials WHERE id=p_key_id AND identity_id=p_identity_id) THEN
      RAISE EXCEPTION 'passkey not found' USING ERRCODE='P0002';
    END IF;
    SELECT count(*) INTO v_count FROM public.passkey_credentials WHERE identity_id=p_identity_id;
    IF v_count <= 1 AND (v_verified IS NULL OR NULLIF(v_phone, '') IS NULL) THEN
      RAISE EXCEPTION 'recovery required' USING ERRCODE='P0001';
    END IF;
    DELETE FROM public.passkey_credentials WHERE id=p_key_id AND identity_id=p_identity_id RETURNING id INTO v_key_id;
    UPDATE public.drivers SET token_version=token_version+1 WHERE identity_id=p_identity_id;
    v_title := 'Passkeyが削除されました';
  END IF;

  INSERT INTO public.notifications(org_id, driver_id, identity_id, kind, title, body, payload)
  VALUES (p_org_id, p_driver_id, p_identity_id, 'account_security', v_title,
    '心当たりがない場合は、すぐに運営へ連絡してください。', jsonb_build_object('action', p_operation))
    RETURNING id INTO v_notification_id;
  RETURN jsonb_build_object('keyId', v_key_id, 'notificationId', v_notification_id);
END;
$$;
REVOKE ALL ON FUNCTION public.manage_passkey(uuid, uuid, uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_passkey(uuid, uuid, uuid, text, jsonb, uuid) TO service_role;

CREATE FUNCTION public.complete_account_recovery(p_request_id uuid,p_driver_id uuid,p_identity_id uuid,p_org_id uuid,p_version integer,p_session_hash text,p_credential jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.account_recovery_requests; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||p_identity_id::text,0));
 SELECT * INTO r FROM public.account_recovery_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'approved' OR r.expires_at<=now() OR r.used_at IS NOT NULL OR r.driver_id<>p_driver_id OR r.identity_id<>p_identity_id OR r.org_id<>p_org_id OR r.token_version<>p_version OR r.session_hash<>p_session_hash THEN RAISE EXCEPTION 'recovery unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.drivers WHERE id=p_driver_id AND identity_id=p_identity_id AND org_id=p_org_id AND token_version=p_version AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'target changed' USING ERRCODE='42501';END IF;
 result:=public.manage_passkey(p_driver_id,p_identity_id,p_org_id,'register',p_credential,NULL);
 UPDATE public.account_recovery_requests SET status='completed',used_at=now() WHERE id=r.id;
 UPDATE public.drivers SET token_version=token_version+1 WHERE identity_id=p_identity_id;
 RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.auth_session_is_revoked(text,text),public.revoke_auth_sessions(uuid,uuid,uuid,integer,jsonb,boolean),public.consume_auth_request_budget(text,text,text),public.request_account_recovery(uuid,uuid,uuid,integer,text),public.decide_account_recovery(uuid,uuid,uuid,uuid,integer,boolean,boolean),public.complete_account_recovery(uuid,uuid,uuid,uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auth_session_is_revoked(text,text),public.revoke_auth_sessions(uuid,uuid,uuid,integer,jsonb,boolean),public.consume_auth_request_budget(text,text,text),public.request_account_recovery(uuid,uuid,uuid,integer,text),public.decide_account_recovery(uuid,uuid,uuid,uuid,integer,boolean,boolean),public.complete_account_recovery(uuid,uuid,uuid,uuid,integer,text,jsonb) TO service_role;

-- 最小権限business経路も、通常APIと同じログアウトを適用する。未導入環境では作らない。
DO $migration$ BEGIN
 IF to_regprocedure('hakotora_security.actor()') IS NOT NULL THEN
  GRANT SELECT(session_id,expires_at) ON public.auth_session_revocations TO hakotora_context_owner;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.auth_session_revocations'::regclass AND polname='context_read_auth_revocations') THEN
   CREATE POLICY context_read_auth_revocations ON public.auth_session_revocations FOR SELECT TO hakotora_context_owner USING(true);
  END IF;
  EXECUTE $actor_definition$CREATE OR REPLACE FUNCTION hakotora_security.actor() RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE envelope text;parts text[];message text;provided bytea;expected bytea;key bytea;claims jsonb;d record;now_epoch bigint;
BEGIN
 envelope:=current_setting('hakotora.assertion',true);parts:=string_to_array(envelope,'.');
 IF envelope IS NULL OR octet_length(envelope)>4096 OR array_length(parts,1)<>3 OR parts[3]!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Business authentication required' USING ERRCODE='28000';END IF;
 SELECT secret INTO key FROM hakotora_security.assertion_keys WHERE kid=parts[1] AND enabled;
 IF key IS NULL THEN RAISE EXCEPTION 'Business authentication unavailable' USING ERRCODE='28000';END IF;
 message:=parts[1]||'.'||parts[2];provided:=decode(parts[3],'hex');expected:=extensions.hmac(convert_to(message,'UTF8'),key,'sha256');
 IF extensions.hmac(provided,key,'sha256')<>extensions.hmac(expected,key,'sha256') THEN RAISE EXCEPTION 'Invalid business signature' USING ERRCODE='28000';END IF;
 claims:=convert_from(decode(translate(parts[2],'-_','+/')||repeat('=',(4-length(parts[2])%4)%4),'base64'),'UTF8')::jsonb;
 IF jsonb_typeof(claims) IS DISTINCT FROM 'object' OR jsonb_typeof(claims->'driverId') IS DISTINCT FROM 'string'
  OR NOT(claims ?& ARRAY['orgId','identityId','companyCode','purpose','tokenVersion','iat','exp','sessionExp','transactionId'])
  OR coalesce(claims->>'transactionId','')!~'^[0-9]+$' OR claims->>'transactionId' IS DISTINCT FROM pg_current_xact_id()::text OR session_user<>'hakotora_runtime'
  OR coalesce(claims->>'tokenVersion','')!~'^[0-9]+$' OR coalesce(claims->>'iat','')!~'^[0-9]+$' OR coalesce(claims->>'exp','')!~'^[0-9]+$' OR coalesce(claims->>'sessionExp','')!~'^[0-9]+$'
  OR jsonb_typeof(claims->'purpose') IS DISTINCT FROM 'string' OR jsonb_typeof(claims->'companyCode') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'Invalid business assertion shape' USING ERRCODE='28000';END IF;
 now_epoch:=floor(extract(epoch from clock_timestamp()));
 IF claims->>'aud' IS DISTINCT FROM 'hakotora-business-db-v1' OR (claims->>'iat')::bigint>now_epoch+5 OR (claims->>'exp')::bigint<=now_epoch OR (claims->>'exp')::bigint>(claims->>'iat')::bigint+30 OR (claims->>'exp')::bigint>(claims->>'sessionExp')::bigint OR claims->>'purpose' NOT IN ('work','admin') THEN RAISE EXCEPTION 'Expired business assertion' USING ERRCODE='28000';END IF;
 IF coalesce(claims->>'sessionId','') !~ '^[0-9a-f-]{36}$|^[0-9a-f]{64}$' OR EXISTS(SELECT 1 FROM public.auth_session_revocations WHERE session_id IN (claims->>'sessionId',claims->>'parentSessionId') AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Revoked business session' USING ERRCODE='28000';END IF;
 SELECT id,org_id,identity_id,role,role_id,status,token_version,company_code INTO d FROM public.drivers WHERE id=(claims->>'driverId')::uuid FOR SHARE;
 IF NOT FOUND OR d.status<>'active' OR d.role='PENDING' OR d.org_id IS NULL OR d.identity_id IS NULL OR d.token_version IS DISTINCT FROM (claims->>'tokenVersion')::integer
  OR (claims->>'orgId' IS NOT NULL AND d.org_id IS DISTINCT FROM (claims->>'orgId')::uuid)
  OR (claims->>'identityId' IS NOT NULL AND d.identity_id IS DISTINCT FROM (claims->>'identityId')::uuid)
  OR NOT EXISTS(SELECT 1 FROM public.identities WHERE id=d.identity_id AND business_access_enabled)
  OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=d.org_id AND business_access_enabled)
  OR (d.role_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.roles WHERE id=d.role_id AND org_id=d.org_id))
 THEN RAISE EXCEPTION 'Inactive or changed membership' USING ERRCODE='28000';END IF;
 RETURN jsonb_build_object('driverId',d.id,'orgId',d.org_id,'identityId',d.identity_id,'role',d.role,'roleId',d.role_id,'purpose',claims->>'purpose');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid business assertion' USING ERRCODE='28000';
END $$;
$actor_definition$;
 END IF;
END $migration$;
