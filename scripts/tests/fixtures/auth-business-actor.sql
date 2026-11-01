-- Test fixture only. No production migration.
CREATE FUNCTION hakotora_security.actor() RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
ALTER FUNCTION hakotora_security.actor() OWNER TO hakotora_context_owner;
