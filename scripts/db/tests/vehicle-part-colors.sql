-- 隔離DBのトランザクション内で実行し、DDL・架空データともROLLBACKする。共有DBへ無断で適用しない。
\i supabase/migrations/164_vehicle_part_colors.sql
INSERT INTO public.organizations(code,name,status) VALUES ('IT_VEHICLE_164','架空の塗装確認会社','active');
DO $$
DECLARE org uuid; vehicle uuid := gen_random_uuid();
BEGIN
  SELECT id INTO org FROM public.organizations WHERE code='IT_VEHICLE_164';
  PERFORM public.save_vehicle_with_drivers(org, vehicle,
    '{"manufacturer":"スズキ","brand":"エブリイ","part_colors":{"hood":"#111111","frontBumper":"#ffffff"}}',NULL,NULL,true);
  IF (SELECT part_colors->>'hood' FROM public.vehicles WHERE id=vehicle) <> '#111111' THEN RAISE EXCEPTION 'part color not saved'; END IF;
  PERFORM public.save_vehicle_with_drivers(org,vehicle,'{"body_color":"#aabbcc"}');
  IF (SELECT part_colors->>'hood' FROM public.vehicles WHERE id=vehicle) <> '#111111' THEN RAISE EXCEPTION 'body change erased part'; END IF;
  BEGIN
    PERFORM public.save_vehicle_with_drivers(gen_random_uuid(),vehicle,'{"part_colors":{}}');
    RAISE EXCEPTION 'foreign vehicle updated';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    PERFORM public.save_vehicle_with_drivers(org,vehicle,'{"part_colors":{"roof":"#ffffff"}}');
    RAISE EXCEPTION 'unknown part accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.save_vehicle_with_drivers(org,vehicle,'{"part_colors":{"hood":null}}');
    RAISE EXCEPTION 'invalid color accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.save_vehicle_with_drivers(org,vehicle,'{"owner_org_id":null}');
    RAISE EXCEPTION 'unknown vehicle field accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.save_vehicle_with_drivers(org,vehicle,'{"part_colors":{}}');
  IF (SELECT part_colors FROM public.vehicles WHERE id=vehicle) <> '{}'::jsonb THEN RAISE EXCEPTION 'reset failed'; END IF;
  IF has_function_privilege('anon','public.save_vehicle_with_drivers(uuid,uuid,jsonb,uuid[],uuid[],boolean)','EXECUTE')
    OR has_function_privilege('authenticated','public.save_vehicle_with_drivers(uuid,uuid,jsonb,uuid[],uuid[],boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'RPC grant widened';
  END IF;
  RAISE NOTICE 'PASS: create/update/reset, preserve part colors, tenant scope, constraints, RPC grants';
END $$;
\i supabase/migrations/164_vehicle_part_colors.sql
