-- 半月グリッドの共有メモ。個人用localStorageと旧shift_memo_daysは変更しない。
CREATE TABLE public.shared_shift_memo_boards (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  board jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_shift_memo_board_object CHECK (jsonb_typeof(board) = 'object'),
  CONSTRAINT shared_shift_memo_board_size CHECK (octet_length(board::text) <= 1048576)
);

ALTER TABLE public.shared_shift_memo_boards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_shift_memo_boards FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shared_shift_memo_boards TO service_role;

CREATE FUNCTION public.save_shared_shift_memo_board(
  p_org_id uuid, p_actor_id uuid, p_initial_board jsonb, p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_revision bigint; v_board jsonb; v_change jsonb; v_field text; v_key text; v_path text[]; v_expected jsonb; v_value jsonb;
BEGIN
  IF (p_initial_board IS NOT NULL AND (jsonb_typeof(p_initial_board) <> 'object'
      OR octet_length(p_initial_board::text) > 1048576))
    OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array'
    OR jsonb_array_length(p_changes) < 1 OR jsonb_array_length(p_changes) > 1000 THEN
    RAISE EXCEPTION 'invalid shared shift memo board' USING ERRCODE = '22023';
  END IF;
  IF p_initial_board IS NOT NULL THEN
    INSERT INTO public.shared_shift_memo_boards (org_id, board, revision, updated_by)
    VALUES (p_org_id, p_initial_board, 0, p_actor_id)
    ON CONFLICT (org_id) DO NOTHING;
  END IF;
  SELECT board, revision INTO v_board, v_revision
    FROM public.shared_shift_memo_boards WHERE org_id = p_org_id FOR UPDATE;
  IF v_board IS NULL THEN
    RAISE EXCEPTION 'shared shift memo board missing' USING ERRCODE = '40001';
  END IF;
  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    v_field := v_change->>'field';
    v_key := v_change->>'key';
    IF v_field NOT IN ('assignments','notes','dayOverrides','requiredCountOverrides',
      'lanes','laneOrder','hiddenLaneIds','routeOrder','hiddenRouteIds','extraPeople','widths')
      OR (v_key IS NOT NULL AND (v_field NOT IN ('assignments','notes','dayOverrides','requiredCountOverrides')
        OR length(v_key) < 1 OR length(v_key) > 200))
      OR (v_key IS NULL AND v_field IN ('assignments','notes','dayOverrides','requiredCountOverrides'))
      OR NOT (v_change ? 'expected') OR NOT (v_change ? 'value') THEN
      RAISE EXCEPTION 'invalid shared shift memo change' USING ERRCODE = '22023';
    END IF;
    v_path := CASE WHEN v_key IS NULL THEN ARRAY[v_field] ELSE ARRAY[v_field,v_key] END;
    v_expected := nullif(v_change->'expected', 'null'::jsonb);
    IF v_board #> v_path IS DISTINCT FROM v_expected THEN
      RETURN jsonb_build_object('saved', false, 'revision', v_revision, 'board', v_board, 'field', v_field, 'key', v_key);
    END IF;
    v_value := v_change->'value';
    IF v_value = 'null'::jsonb THEN v_board := v_board #- v_path;
    ELSE v_board := jsonb_set(v_board, v_path, v_value, true);
    END IF;
  END LOOP;
  IF octet_length(v_board::text) > 1048576 THEN
    RAISE EXCEPTION 'shared shift memo board too large' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shared_shift_memo_boards
     SET board = v_board, revision = revision + 1, updated_by = p_actor_id, updated_at = now()
   WHERE org_id = p_org_id RETURNING revision INTO v_revision;
  RETURN jsonb_build_object('saved', true, 'revision', v_revision, 'board', v_board);
END;
$$;
REVOKE ALL ON FUNCTION public.save_shared_shift_memo_board(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_shared_shift_memo_board(uuid,uuid,jsonb,jsonb) TO service_role;
