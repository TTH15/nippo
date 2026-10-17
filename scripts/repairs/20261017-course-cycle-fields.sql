-- 確認済みの2コースだけ、C1=午前/C2=午後を設定する。本番未実行。
-- 既定は検証のみ(ROLLBACK)。適用時は結果を確認した上で末尾をCOMMITに変更する。
-- 20261017081031_bind_course_report_fields.sql の適用後に使用する。
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $$
DECLARE c record; unit uuid; selections jsonb; target_count int := 0;
BEGIN
  FOR c IN SELECT id, name, carrier_id, uses_cycles FROM public.courses
    WHERE org_id = '1314c7a1-0f86-44fd-8f60-01588735295a'::uuid
      AND name IN ('久御山 Amazon', '豊中 Amazon')
    ORDER BY id FOR UPDATE
  LOOP
    target_count := target_count + 1;
    IF NOT c.uses_cycles OR (SELECT count(*) FROM public.course_cycles cc WHERE cc.course_id = c.id AND cc.active) <> 2
      OR NOT EXISTS (SELECT FROM public.course_cycles cc WHERE cc.course_id = c.id AND cc.active AND cc.cycle_no = 1)
      OR NOT EXISTS (SELECT FROM public.course_cycles cc WHERE cc.course_id = c.id AND cc.active AND cc.cycle_no = 2)
    THEN RAISE EXCEPTION '便の設定が調査時から変わっています: %', c.name; END IF;
    SELECT u.id INTO STRICT unit FROM public.units u WHERE u.carrier_id = c.carrier_id AND u.code = 'AMAZON_DELIVERY' AND u.active;
    SELECT jsonb_agg(jsonb_build_object('cycle_no', CASE WHEN f.field_key LIKE 'am_%' THEN 1 ELSE 2 END,
      'unit_id', unit, 'field_key', f.field_key)) INTO selections
    FROM public.unit_fields f WHERE f.unit_id = unit AND f.field_key IN ('am_mochidashi','am_completed','pm_mochidashi','pm_completed');
    IF jsonb_array_length(selections) IS DISTINCT FROM 4 THEN RAISE EXCEPTION '日報項目が調査時から変わっています: %', c.name; END IF;
    -- 既に誰かが設定していれば競合で中止。現在の設定を上書きしない。
    PERFORM public.replace_course_report_fields('1314c7a1-0f86-44fd-8f60-01588735295a'::uuid, c.id, selections, '[]'::jsonb);
  END LOOP;
  IF target_count <> 2 THEN RAISE EXCEPTION '対象コース数が調査時から変わっています'; END IF;
END $$;
SELECT c.name, f.cycle_no, uf.group_label, uf.label FROM public.course_report_fields f
JOIN public.courses c ON c.id = f.course_id JOIN public.unit_fields uf ON uf.unit_id = f.unit_id AND uf.field_key = f.field_key
WHERE c.org_id = '1314c7a1-0f86-44fd-8f60-01588735295a'::uuid AND c.name IN ('久御山 Amazon', '豊中 Amazon')
ORDER BY c.name, f.cycle_no, uf.field_key;
ROLLBACK;
