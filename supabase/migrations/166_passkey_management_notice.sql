-- 本人の鍵変更とインボックス通知を同じトランザクションで確定する。
-- Webで直近の本人確認・現在の所属を検証したあと、service_roleだけが呼ぶ。
SET LOCAL lock_timeout = '3s';

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
