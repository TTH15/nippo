-- Expiry must be checked after lock waits against wall-clock time.
-- Existing function owners and EXECUTE ACL are preserved.
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION public.request_account_recovery(p_driver_id uuid,p_identity_id uuid,p_org_id uuid,p_version integer,p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.account_recovery_requests; notice uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||p_identity_id::text,0));
 PERFORM 1 FROM public.drivers d JOIN public.identities i ON i.id=d.identity_id
  WHERE d.id=p_driver_id AND d.identity_id=p_identity_id AND d.org_id=p_org_id AND d.status='active' AND d.token_version=p_version AND i.phone_verified_at IS NOT NULL FOR SHARE OF d;
 IF NOT FOUND THEN RAISE EXCEPTION 'membership mismatch' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.account_recovery_requests WHERE driver_id=p_driver_id AND session_hash=p_session_hash FOR UPDATE;
 IF FOUND AND r.expires_at>clock_timestamp() AND r.status IN ('pending','approved') AND r.token_version=p_version THEN
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

CREATE OR REPLACE FUNCTION public.decide_account_recovery(p_request_id uuid,p_actor_driver_id uuid,p_actor_identity_id uuid,p_actor_org_id uuid,p_actor_version integer,p_approve boolean,p_platform boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.account_recovery_requests; notice uuid; target_identity uuid;
BEGIN
 SELECT identity_id INTO target_identity FROM public.account_recovery_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'request unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||target_identity::text,0));
 SELECT * INTO r FROM public.account_recovery_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'request unavailable' USING ERRCODE='P0002';END IF;
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
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'request expired during verification' USING ERRCODE='P0002';END IF;
 UPDATE public.account_recovery_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
  approved_by=p_actor_identity_id,approved_at=now(),expires_at=CASE WHEN p_approve THEN clock_timestamp()+interval '15 minutes' ELSE expires_at END WHERE id=r.id;
 INSERT INTO public.notifications(org_id,driver_id,identity_id,kind,title,body,payload)
 VALUES(r.org_id,r.driver_id,r.identity_id,'account_security',CASE WHEN p_approve THEN 'パスキーの復旧が承認されました' ELSE 'パスキーの復旧は承認されませんでした' END,
 CASE WHEN p_approve THEN '15分以内に申請した画面でパスキーを追加してください。' ELSE '管理者または運営窓口へ確認してください。' END,jsonb_build_object('action','decide_recovery','requestId',r.id)) RETURNING id INTO notice;
 INSERT INTO public.platform_audit_logs(actor_identity_id,action,target,detail) VALUES(p_actor_identity_id,'account_recovery_decision',r.id::text,jsonb_build_object('approved',p_approve,'platform',p_platform,'orgId',r.org_id));
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'request expired during decision' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('ok',true,'notificationId',notice,'orgId',r.org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_account_recovery(p_request_id uuid,p_driver_id uuid,p_identity_id uuid,p_org_id uuid,p_version integer,p_session_hash text,p_credential jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.account_recovery_requests; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('auth-identity:'||p_identity_id::text,0));
 SELECT * INTO r FROM public.account_recovery_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'approved' OR r.expires_at<=clock_timestamp() OR r.used_at IS NOT NULL OR r.driver_id<>p_driver_id OR r.identity_id<>p_identity_id OR r.org_id<>p_org_id OR r.token_version<>p_version OR r.session_hash<>p_session_hash THEN RAISE EXCEPTION 'recovery unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.drivers WHERE id=p_driver_id AND identity_id=p_identity_id AND org_id=p_org_id AND token_version=p_version AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'target changed' USING ERRCODE='42501';END IF;
 result:=public.manage_passkey(p_driver_id,p_identity_id,p_org_id,'register',p_credential,NULL);
 UPDATE public.account_recovery_requests SET status='completed',used_at=now() WHERE id=r.id;
 UPDATE public.drivers SET token_version=token_version+1 WHERE identity_id=p_identity_id;
 IF r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'recovery expired during completion' USING ERRCODE='42501';END IF;
 RETURN result;
END;
$$;
