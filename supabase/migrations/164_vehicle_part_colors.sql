-- 車体全体と独立した塗装色。未指定の部位は従来の車体色・元の材質を使う。
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS part_colors jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_part_colors_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_part_colors_check CHECK (
  jsonb_typeof(part_colors) = 'object'
  AND (part_colors - 'hood' - 'frontBumper' - 'rearBumper') = '{}'::jsonb
  AND (NOT part_colors ? 'hood' OR (jsonb_typeof(part_colors->'hood') = 'string' AND part_colors->>'hood' ~ '^#[0-9a-fA-F]{6}$'))
  AND (NOT part_colors ? 'frontBumper' OR (jsonb_typeof(part_colors->'frontBumper') = 'string' AND part_colors->>'frontBumper' ~ '^#[0-9a-fA-F]{6}$'))
  AND (NOT part_colors ? 'rearBumper' OR (jsonb_typeof(part_colors->'rearBumper') = 'string' AND part_colors->>'rearBumper' ~ '^#[0-9a-fA-F]{6}$'))
);
COMMENT ON COLUMN public.vehicles.part_colors IS 'ボンネット・前後バンパーの個別色。キー未設定は全体色または元の材質色';
-- 155の会社スコープ・紐付け競合検査を維持し、許可フィールドへ部位色だけを追加。
CREATE OR REPLACE FUNCTION public.save_vehicle_with_drivers(
  p_org_id uuid, p_vehicle_id uuid, p_patch jsonb,
  p_driver_ids uuid[] DEFAULT NULL, p_expected_driver_ids uuid[] DEFAULT NULL, p_create boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE assignments text; columns_list text; result jsonb; current_ids uuid[]; expected_ids uuid[]; target_ids uuid[]; found_count integer;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' THEN
    RAISE EXCEPTION 'Invalid vehicle patch' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) AS k(key) WHERE key<>ALL(ARRAY[
    'updated_at','manufacturer','model_key','model_code','body_color','part_colors','brand','is_disposed',
    'is_unavailable','unavailable_reason','is_ev','plate_color','number_prefix','number_class',
    'number_hiragana','number_numeric','current_mileage','last_oil_change_mileage','oil_change_interval',
    'purchase_cost_items','purchase_cost','lease_cost','monthly_insurance','recovery_start_month',
    'recovery_carryover','image_url','image_focus_x','image_focus_y','next_shaken_date','jibaiseki_renewal_month'
  ])) THEN RAISE EXCEPTION 'Invalid vehicle field' USING ERRCODE='22023'; END IF;
  IF p_create THEN
    SELECT string_agg(format('%I',key),', '),string_agg(format('patch.%I',key),', ')
      INTO columns_list,assignments FROM jsonb_object_keys(p_patch) AS k(key);
    IF columns_list IS NULL THEN RAISE EXCEPTION 'Vehicle fields required' USING ERRCODE='22023'; END IF;
    EXECUTE format('INSERT INTO public.vehicles(id,owner_org_id,%s) SELECT $2,$3,%s FROM jsonb_populate_record(NULL::public.vehicles,$1) patch',columns_list,assignments)
      USING p_patch,p_vehicle_id,p_org_id;
  END IF;
  PERFORM 1 FROM public.vehicles WHERE id=p_vehicle_id AND owner_org_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found' USING ERRCODE='P0002'; END IF;
  IF p_driver_ids IS NOT NULL THEN
    IF p_expected_driver_ids IS NULL OR array_position(p_driver_ids,NULL) IS NOT NULL
      OR array_position(p_expected_driver_ids,NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'Driver baseline required' USING ERRCODE='22023';
    END IF;
    SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}'::uuid[]) INTO target_ids FROM unnest(p_driver_ids) AS t(id);
    -- 所属変更・削除と競合しないよう、ID順でドライバーをロックする。
    PERFORM id FROM public.drivers WHERE id=ANY(target_ids) AND org_id=p_org_id ORDER BY id FOR SHARE;
    GET DIAGNOSTICS found_count = ROW_COUNT;
    IF found_count<>cardinality(target_ids) THEN
      RAISE EXCEPTION 'Driver not found' USING ERRCODE='P0002';
    END IF;
    SELECT coalesce(array_agg(driver_id ORDER BY driver_id),'{}'::uuid[]) INTO current_ids
      FROM public.vehicle_drivers WHERE vehicle_id=p_vehicle_id;
    SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}'::uuid[]) INTO expected_ids FROM unnest(p_expected_driver_ids) AS t(id);
    IF current_ids IS DISTINCT FROM expected_ids THEN
      RAISE EXCEPTION 'Vehicle links changed; reload before saving' USING ERRCODE='40001';
    END IF;
  END IF;
  p_patch := p_patch || jsonb_build_object('updated_at',clock_timestamp());
  SELECT string_agg(format('%1$I = patch.%1$I',key),', ') INTO assignments FROM jsonb_object_keys(p_patch) AS k(key);
  EXECUTE format('UPDATE public.vehicles v SET %s FROM jsonb_populate_record(NULL::public.vehicles,$1) patch WHERE v.id=$2 AND v.owner_org_id=$3',assignments)
    USING p_patch,p_vehicle_id,p_org_id;
  IF p_driver_ids IS NOT NULL THEN
    DELETE FROM public.vehicle_drivers WHERE vehicle_id=p_vehicle_id AND NOT(driver_id=ANY(target_ids));
    INSERT INTO public.vehicle_drivers(vehicle_id,driver_id)
      SELECT p_vehicle_id,id FROM unnest(target_ids) AS t(id) ON CONFLICT(vehicle_id,driver_id) DO NOTHING;
  END IF;
  SELECT to_jsonb(v) || jsonb_build_object(
    'driver_link_ids',coalesce((SELECT jsonb_agg(d.id ORDER BY d.id) FROM public.vehicle_drivers vd JOIN public.drivers d ON d.id=vd.driver_id
      WHERE vd.vehicle_id=p_vehicle_id AND d.org_id=p_org_id),'[]'::jsonb),
    'vehicle_drivers',coalesce((SELECT jsonb_agg(jsonb_build_object('driver_id',d.id,'drivers',jsonb_build_object('id',d.id,'name',d.name,'display_name',d.display_name)))
      FROM public.vehicle_drivers vd JOIN public.drivers d ON d.id=vd.driver_id WHERE vd.vehicle_id=p_vehicle_id AND d.org_id=p_org_id),'[]'::jsonb))
    INTO result FROM public.vehicles v WHERE v.id=p_vehicle_id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.save_vehicle_with_drivers(uuid,uuid,jsonb,uuid[],uuid[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_vehicle_with_drivers(uuid,uuid,jsonb,uuid[],uuid[],boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
