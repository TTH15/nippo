-- 曜日・日付の背景色を追加。配置・正式シフト・認証/RLS/ACLは変更しない。
-- 現在の定義を使い、既存のactor guard/SECURITY属性/search_path/所有者/ACLを保持する。
DO $migration$
DECLARE
  signature text;
  function_id regprocedure;
  definition text;
  old_maps constant text := '''assignments'',''notes'',''dayOverrides'',''requiredCountOverrides''';
  path_line constant text := '    v_path := CASE WHEN v_key IS NULL THEN ARRAY[v_field] ELSE ARRAY[v_field,v_key] END;';
  validation constant text := $validation$
    IF v_field = 'backgroundColors' THEN
      IF v_key IS NULL OR v_key !~ '^(weekday:[0-6]|date:[0-9]{4}-[0-9]{2}-[0-9]{2}|row:.+|course:.+|cell:.+[|][0-9]{4}-[0-9]{2}-[0-9]{2})$' OR v_change->'value' NOT IN ('"none"'::jsonb, '"yellow"'::jsonb, '"rose"'::jsonb, '"sky"'::jsonb, '"green"'::jsonb, '"violet"'::jsonb, 'null'::jsonb) THEN
        RAISE EXCEPTION 'invalid shift memo background color' USING ERRCODE = '22023';
      END IF;
      -- jsonb_setは途中の親を作らないため、旧盤面にも空のmapを用意する。
      IF jsonb_typeof(v_board->'backgroundColors') IS DISTINCT FROM 'object' THEN
        v_board := jsonb_set(v_board, ARRAY['backgroundColors'], '{}'::jsonb, true);
      END IF;
    END IF;
$validation$;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.save_shared_shift_memo_board(uuid,uuid,jsonb,jsonb)',
    'public.save_shared_shift_memo_board_runtime(uuid,uuid,jsonb,jsonb)'
  ] LOOP
    function_id := to_regprocedure(signature);
    IF function_id IS NULL THEN
      IF signature LIKE '%_runtime(%' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'shared memo RPC missing: %', signature;
    END IF;
    definition := pg_get_functiondef(function_id);
    IF position('invalid shift memo background color' IN definition) > 0 THEN CONTINUE; END IF;
    IF (length(definition) - length(replace(definition, old_maps, ''))) / length(old_maps) <> 3
      OR position(path_line IN definition) = 0 OR position('FOR UPDATE' IN definition) = 0 THEN
      RAISE EXCEPTION 'shared memo RPC definition requires review: %', signature;
    END IF;
    definition := replace(definition, old_maps, old_maps || ',''backgroundColors''');
    definition := replace(definition, path_line, validation || path_line);
    EXECUTE definition;
  END LOOP;
END;
$migration$;
