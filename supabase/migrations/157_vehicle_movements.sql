-- ============================================================
-- 車両移動の予定と完了記録
--
-- 予定（どこからどこへ、誰が、いつまでに）と現在地の実績を分離する。
-- 手配の保存だけでは vehicle_positions を更新せず、「完了を記録」で初めて
-- source='manual' の位置履歴を追記する。
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicle_movements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL,
  vehicle_id          uuid        NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  from_place_id       uuid        NOT NULL REFERENCES public.map_places(id),
  to_place_id         uuid        NOT NULL REFERENCES public.map_places(id),
  assignee_driver_id  uuid        REFERENCES public.drivers(id) ON DELETE SET NULL,
  due_at              timestamptz NOT NULL,
  status              text        NOT NULL CHECK (status IN ('needed', 'planned', 'arrived', 'cancelled')),
  note                text,
  actual_place_id     uuid        REFERENCES public.map_places(id),
  arrived_at          timestamptz,
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by          uuid        NOT NULL REFERENCES public.drivers(id),
  updated_by          uuid        NOT NULL REFERENCES public.drivers(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(coalesce(note, '')) <= 200),
  CHECK ((actual_place_id IS NULL) = (arrived_at IS NULL)),
  CHECK (status <> 'arrived' OR actual_place_id = to_place_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_movements_org_due
  ON public.vehicle_movements (org_id, due_at, id);
CREATE INDEX IF NOT EXISTS idx_vehicle_movements_vehicle_due
  ON public.vehicle_movements (org_id, vehicle_id, due_at, id);
CREATE INDEX IF NOT EXISTS idx_vehicle_movements_active
  ON public.vehicle_movements (org_id, status, due_at)
  WHERE status IN ('needed', 'planned');

COMMENT ON TABLE public.vehicle_movements IS
  '車両移動の予定。現在地の実績とは分離し、到着記録時だけvehicle_positionsへ追記する';
COMMENT ON COLUMN public.vehicle_movements.status IS
  'needed=担当未設定 / planned=手配済み / arrived=届け先へ到着 / cancelled=取消';

CREATE OR REPLACE FUNCTION public.save_vehicle_movement(
  p_org_id uuid,
  p_actor_id uuid,
  p_movement_id uuid,
  p_vehicle_id uuid,
  p_from_place_id uuid,
  p_to_place_id uuid,
  p_assignee_driver_id uuid,
  p_due_at timestamptz,
  p_note text,
  p_expected_version integer DEFAULT NULL,
  p_create boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_row public.vehicle_movements%ROWTYPE;
  saved_row public.vehicle_movements%ROWTYPE;
  next_status text;
  place_count integer;
BEGIN
  IF p_org_id IS NULL OR p_actor_id IS NULL OR p_movement_id IS NULL
    OR p_vehicle_id IS NULL OR p_from_place_id IS NULL OR p_to_place_id IS NULL
    OR p_due_at IS NULL OR char_length(coalesce(p_note, '')) > 200 THEN
    RAISE EXCEPTION 'Invalid vehicle movement' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.drivers
    WHERE id = p_actor_id AND org_id = p_org_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor not found' USING ERRCODE = 'P0002'; END IF;

  PERFORM 1 FROM public.vehicles
    WHERE id = p_vehicle_id AND owner_org_id = p_org_id AND NOT coalesce(is_disposed, false)
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found' USING ERRCODE = 'P0002'; END IF;

  PERFORM id FROM public.map_places
    WHERE id IN (p_from_place_id, p_to_place_id) AND org_id = p_org_id
    ORDER BY id FOR SHARE;
  SELECT count(*) INTO place_count
    FROM public.map_places
    WHERE id IN (p_from_place_id, p_to_place_id) AND org_id = p_org_id;
  IF place_count <> (CASE WHEN p_from_place_id = p_to_place_id THEN 1 ELSE 2 END) THEN
    RAISE EXCEPTION 'Place not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_assignee_driver_id IS NOT NULL THEN
    PERFORM 1 FROM public.drivers
      WHERE id = p_assignee_driver_id AND org_id = p_org_id
        AND status = 'active' AND coalesce(works_as_driver, false)
      FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignee not found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  next_status := CASE WHEN p_assignee_driver_id IS NULL THEN 'needed' ELSE 'planned' END;

  IF p_create THEN
    INSERT INTO public.vehicle_movements (
      id, org_id, vehicle_id, from_place_id, to_place_id,
      assignee_driver_id, due_at, status, note, created_by, updated_by
    ) VALUES (
      p_movement_id, p_org_id, p_vehicle_id, p_from_place_id, p_to_place_id,
      p_assignee_driver_id, p_due_at, next_status, nullif(btrim(p_note), ''), p_actor_id, p_actor_id
    )
    RETURNING * INTO saved_row;
  ELSE
    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION 'Expected version required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO current_row FROM public.vehicle_movements
      WHERE id = p_movement_id AND org_id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Movement not found' USING ERRCODE = 'P0002'; END IF;
    IF current_row.version <> p_expected_version THEN
      RAISE EXCEPTION 'Movement changed; reload before saving' USING ERRCODE = '40001';
    END IF;
    IF current_row.status IN ('arrived', 'cancelled') THEN
      RAISE EXCEPTION 'Finished movement cannot be edited' USING ERRCODE = '22023';
    END IF;

    UPDATE public.vehicle_movements SET
      vehicle_id = p_vehicle_id,
      from_place_id = p_from_place_id,
      to_place_id = p_to_place_id,
      assignee_driver_id = p_assignee_driver_id,
      due_at = p_due_at,
      status = next_status,
      note = nullif(btrim(p_note), ''),
      actual_place_id = NULL,
      arrived_at = NULL,
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = clock_timestamp()
    WHERE id = p_movement_id AND org_id = p_org_id
    RETURNING * INTO saved_row;
  END IF;

  RETURN to_jsonb(saved_row);
END $$;

CREATE OR REPLACE FUNCTION public.finish_vehicle_movement(
  p_org_id uuid,
  p_actor_id uuid,
  p_movement_id uuid,
  p_actual_place_id uuid,
  p_arrived_at timestamptz,
  p_expected_version integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_row public.vehicle_movements%ROWTYPE;
  saved_row public.vehicle_movements%ROWTYPE;
  actual_lat double precision;
  actual_lng double precision;
BEGIN
  IF p_org_id IS NULL OR p_actor_id IS NULL OR p_movement_id IS NULL
    OR p_actual_place_id IS NULL OR p_arrived_at IS NULL OR p_expected_version IS NULL
    OR p_arrived_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Invalid arrival' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.drivers
    WHERE id = p_actor_id AND org_id = p_org_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO current_row FROM public.vehicle_movements
    WHERE id = p_movement_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movement not found' USING ERRCODE = 'P0002'; END IF;
  IF current_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Movement changed; reload before saving' USING ERRCODE = '40001';
  END IF;
  IF current_row.status IN ('arrived', 'cancelled') THEN
    RAISE EXCEPTION 'Movement already finished' USING ERRCODE = '22023';
  END IF;

  SELECT lat, lng INTO actual_lat, actual_lng FROM public.map_places
    WHERE id = p_actual_place_id AND org_id = p_org_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Place not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.vehicle_positions (
    org_id, vehicle_id, at, lat, lng, source, recorded_by, note
  ) VALUES (
    p_org_id, current_row.vehicle_id, p_arrived_at, actual_lat, actual_lng,
    'manual', p_actor_id, '車両移動の完了記録'
  );

  UPDATE public.vehicle_movements SET
    actual_place_id = p_actual_place_id,
    arrived_at = p_arrived_at,
    status = CASE
      WHEN p_actual_place_id = to_place_id THEN 'arrived'
      WHEN assignee_driver_id IS NULL THEN 'needed'
      ELSE 'planned'
    END,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = clock_timestamp()
  WHERE id = p_movement_id AND org_id = p_org_id
  RETURNING * INTO saved_row;

  RETURN to_jsonb(saved_row);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_vehicle_movement(
  p_org_id uuid,
  p_actor_id uuid,
  p_movement_id uuid,
  p_expected_version integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_row public.vehicle_movements%ROWTYPE;
BEGIN
  IF p_org_id IS NULL OR p_actor_id IS NULL OR p_movement_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'Invalid cancellation' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.drivers
    WHERE id = p_actor_id AND org_id = p_org_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO current_row FROM public.vehicle_movements
    WHERE id = p_movement_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movement not found' USING ERRCODE = 'P0002'; END IF;
  IF current_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Movement changed; reload before saving' USING ERRCODE = '40001';
  END IF;
  IF current_row.status IN ('arrived', 'cancelled') THEN
    RAISE EXCEPTION 'Movement already finished' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vehicle_movements SET
    status = 'cancelled',
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = clock_timestamp()
  WHERE id = p_movement_id AND org_id = p_org_id
  RETURNING * INTO current_row;
  RETURN to_jsonb(current_row);
END $$;

REVOKE ALL ON FUNCTION public.save_vehicle_movement(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_vehicle_movement(uuid,uuid,uuid,uuid,timestamptz,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_vehicle_movement(uuid,uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_vehicle_movement(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_vehicle_movement(uuid,uuid,uuid,uuid,timestamptz,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_vehicle_movement(uuid,uuid,uuid,integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
