-- 専用開発DBで BEGIN/ROLLBACK する。本人・他人・通知・復旧手段・公開権限を検査。
\i supabase/migrations/166_passkey_management_notice.sql
DO $$
DECLARE
  org uuid; person uuid; other_person uuid; member uuid; other_member uuid;
  result jsonb; first_key uuid; second_key uuid; before_count integer;
BEGIN
  INSERT INTO public.organizations(code,name,status) VALUES ('IT_PASSKEY_166','架空の認証確認会社','active') RETURNING id INTO org;
  INSERT INTO public.identities(name) VALUES ('架空の本人') RETURNING id INTO person;
  INSERT INTO public.identities(name) VALUES ('架空の別人') RETURNING id INTO other_person;
  INSERT INTO public.drivers(name,role,org_id,identity_id,status) VALUES ('架空の本人','DRIVER',org,person,'active') RETURNING id INTO member;
  INSERT INTO public.drivers(name,role,org_id,identity_id,status) VALUES ('架空の別人','DRIVER',org,other_person,'active') RETURNING id INTO other_member;
  result := public.manage_passkey(member,person,org,'register',jsonb_build_object('credential_id','test-166-a','public_key','\x01','counter',0,'backed_up',true,'device_type','multiDevice'));
  first_key := (result->>'keyId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=(result->>'notificationId')::uuid AND identity_id=person AND org_id=org) THEN RAISE EXCEPTION 'missing notice'; END IF;
  BEGIN
    PERFORM public.manage_passkey(member,person,org,'delete',NULL,first_key);
    RAISE EXCEPTION 'deleted final key without recovery' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  BEGIN
    PERFORM public.manage_passkey(other_member,other_person,org,'delete',NULL,first_key);
    RAISE EXCEPTION 'deleted foreign key';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    PERFORM public.manage_passkey(member,other_person,org,'delete',NULL,first_key);
    RAISE EXCEPTION 'membership bypass';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.manage_passkey(member,person,gen_random_uuid(),'delete',NULL,first_key);
    RAISE EXCEPTION 'org bypass';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  result := public.manage_passkey(member,person,org,'register',jsonb_build_object('credential_id','test-166-b','public_key','\x02','counter',0,'backed_up',true,'device_type','multiDevice'));
  second_key := (result->>'keyId')::uuid;
  PERFORM public.manage_passkey(member,person,org,'delete',NULL,first_key);
  UPDATE public.identities SET phone='+819000000001',phone_verified_at=now() WHERE id=person;
  PERFORM public.manage_passkey(member,person,org,'delete',NULL,second_key);
  IF (SELECT count(*) FROM public.notifications WHERE identity_id=person) <> 4 THEN RAISE EXCEPTION 'notice count mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.passkey_credentials WHERE identity_id=person) THEN RAISE EXCEPTION 'delete failed'; END IF;
  UPDATE public.drivers SET status='inactive' WHERE id=member;
  BEGIN
    PERFORM public.manage_passkey(member,person,org,'register','{}');
    RAISE EXCEPTION 'inactive membership';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege('anon','public.manage_passkey(uuid,uuid,uuid,text,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.manage_passkey(uuid,uuid,uuid,text,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public RPC'; END IF;
  RAISE NOTICE 'PASS: register/delete, atomic notice, last-key recovery, foreign identity/org, inactive membership, private RPC';
END $$;
