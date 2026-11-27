BEGIN;
CREATE TABLE public.driver_report_requirements (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  parking_required boolean NOT NULL DEFAULT true
);
ALTER TABLE public.driver_report_requirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_report_requirements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_report_requirements TO service_role;

-- Capture the existing exemption once. Future billing changes never change these preferences.
WITH current_contract AS (
  SELECT DISTINCT ON (driver_id) driver_id, mode, amount FROM public.driver_leases
  WHERE valid_from <= (now() AT TIME ZONE 'Asia/Tokyo')::date
    AND (valid_to IS NULL OR valid_to >= (now() AT TIME ZONE 'Asia/Tokyo')::date)
  ORDER BY driver_id, valid_from DESC, id
)
INSERT INTO public.driver_report_requirements(driver_id,parking_required)
SELECT driver_id,false FROM current_contract WHERE mode='MONTHLY' AND amount>0;

CREATE FUNCTION public.driver_settings_overview(p_org uuid, p_leases boolean, p_vehicles boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object(
   'drivers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', coalesce(nullif(d.display_name,''),d.name),
      'lease', CASE WHEN p_leases THEN (SELECT l.mode FROM driver_leases l WHERE l.driver_id=d.id
        AND l.valid_from<=(now() AT TIME ZONE 'Asia/Tokyo')::date
        AND (l.valid_to IS NULL OR l.valid_to>=(now() AT TIME ZONE 'Asia/Tokyo')::date)
        ORDER BY l.valid_from DESC,l.id LIMIT 1) END,
      'parking', coalesce(r.parking_required,true),
      'vehicleIds', CASE WHEN p_vehicles THEN coalesce((SELECT jsonb_agg(v.id ORDER BY v.id)
        FROM vehicle_drivers a JOIN vehicles v ON v.id=a.vehicle_id
        WHERE a.driver_id=d.id AND v.owner_org_id=p_org AND NOT coalesce(v.is_disposed,false)), '[]'::jsonb)
        ELSE '[]'::jsonb END
   ) ORDER BY d.list_no NULLS LAST,d.name,d.id) FROM drivers d
   LEFT JOIN driver_report_requirements r ON r.driver_id=d.id
   WHERE d.org_id=p_org AND d.works_as_driver AND d.status='active'), '[]'::jsonb),
   'vehicles', CASE WHEN p_vehicles THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id',id,'number_prefix',number_prefix,'number_class',number_class,'number_hiragana',number_hiragana,
     'number_numeric',number_numeric,'plate_color',plate_color,'brand',brand,'is_unavailable',is_unavailable
   ) ORDER BY number_numeric,id) FROM vehicles WHERE owner_org_id=p_org AND NOT coalesce(is_disposed,false)), '[]'::jsonb)
   ELSE '[]'::jsonb END)
$$;

CREATE FUNCTION public.set_driver_parking_requirement(p_org uuid,p_driver uuid,p_value boolean,p_expected boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_value boolean;
BEGIN
  PERFORM 1 FROM drivers WHERE org_id=p_org AND id=p_driver AND status='active' AND works_as_driver FOR UPDATE;
  IF NOT FOUND THEN RAISE NO_DATA_FOUND; END IF;
  IF p_value IS NULL OR p_expected IS NULL THEN
    RAISE EXCEPTION 'Invalid requirement' USING ERRCODE='22023';
  END IF;
  INSERT INTO driver_report_requirements(driver_id) VALUES(p_driver) ON CONFLICT DO NOTHING;
  SELECT parking_required INTO current_value
    FROM driver_report_requirements WHERE driver_id=p_driver FOR UPDATE;
  IF current_value=p_value THEN RETURN; END IF;
  IF current_value IS DISTINCT FROM p_expected THEN RAISE serialization_failure; END IF;
  UPDATE driver_report_requirements SET parking_required=p_value WHERE driver_id=p_driver;
END $$;

CREATE FUNCTION public.set_driver_vehicle_links(p_org uuid,p_driver uuid,p_ids uuid[],p_expected uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE existing uuid[]; desired uuid[];
BEGIN
  IF p_ids IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'Missing links' USING ERRCODE='22023'; END IF;
  SELECT ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x ORDER BY x) INTO desired;
  -- Vehicle editor also locks the vehicle before the driver. Preserve disposed and other-owner links.
  PERFORM 1 FROM vehicles WHERE owner_org_id=p_org AND id=ANY(p_ids || p_expected) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM drivers WHERE org_id=p_org AND id=p_driver AND status='active' AND works_as_driver FOR UPDATE;
  IF NOT FOUND THEN RAISE NO_DATA_FOUND; END IF;
  IF EXISTS (SELECT 1 FROM unnest(desired) x WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE
    id=x AND owner_org_id=p_org AND NOT coalesce(is_disposed,false))) THEN RAISE NO_DATA_FOUND; END IF;
  SELECT ARRAY(SELECT v.id FROM vehicle_drivers a JOIN vehicles v ON v.id=a.vehicle_id
    WHERE a.driver_id=p_driver AND v.owner_org_id=p_org AND NOT coalesce(v.is_disposed,false) ORDER BY v.id) INTO existing;
  IF existing=desired THEN RETURN; END IF;
  IF existing IS DISTINCT FROM ARRAY(SELECT DISTINCT x FROM unnest(p_expected) x ORDER BY x) THEN RAISE serialization_failure; END IF;
  DELETE FROM vehicle_drivers WHERE driver_id=p_driver AND vehicle_id=ANY(existing) AND NOT(vehicle_id=ANY(desired));
  INSERT INTO vehicle_drivers(driver_id,vehicle_id) SELECT p_driver,x FROM unnest(desired) x ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.driver_settings_overview(uuid,boolean,boolean), public.set_driver_parking_requirement(uuid,uuid,boolean,boolean), public.set_driver_vehicle_links(uuid,uuid,uuid[],uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_settings_overview(uuid,boolean,boolean), public.set_driver_parking_requirement(uuid,uuid,boolean,boolean), public.set_driver_vehicle_links(uuid,uuid,uuid[],uuid[]) TO service_role;
COMMIT;
