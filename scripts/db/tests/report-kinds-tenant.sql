-- 開発DB専用。db.sh dryrunで外側のトランザクションを必ずROLLBACKする。
CREATE TEMP TABLE report_kinds_before AS SELECT * FROM public.report_kinds;
INSERT INTO public.organizations(code, name, status) VALUES ('IT_SCOPE_163', '架空の分離検証会社', 'active');
\i supabase/migrations/163_report_kinds_tenant_scope.sql
DO $$
DECLARE target uuid; legacy uuid; kind_id uuid; before_label text; affected integer;
BEGIN
 SELECT id INTO target FROM public.organizations WHERE code = 'IT_SCOPE_163';
 SELECT id INTO legacy FROM public.organizations WHERE code = 'ACE';
 IF (SELECT count(*) FROM public.report_kinds WHERE org_id = target) <> (SELECT count(*) FROM report_kinds_before) THEN
   RAISE EXCEPTION 'Existing settings were not copied';
 END IF;
 IF EXISTS (SELECT 1 FROM report_kinds_before b LEFT JOIN public.report_kinds k ON k.id=b.id AND k.org_id=legacy WHERE k.id IS NULL OR k.key<>b.key OR k.fields<>b.fields) THEN
   RAISE EXCEPTION 'Legacy ids/keys/fields changed';
 END IF;
 SELECT id,label INTO kind_id,before_label FROM public.report_kinds WHERE org_id=legacy LIMIT 1;
 UPDATE public.report_kinds SET label='not allowed' WHERE id=kind_id AND org_id=target;
 GET DIAGNOSTICS affected = ROW_COUNT;
 IF affected <> 0 THEN RAISE EXCEPTION 'Cross-tenant update succeeded'; END IF;
 IF (SELECT label FROM public.report_kinds WHERE id=kind_id) <> before_label THEN RAISE EXCEPTION 'Foreign row changed'; END IF;
 INSERT INTO public.report_kinds(org_id,key,label) VALUES(target,'tenant_test','自社種別'),(legacy,'tenant_test','別社種別');
 BEGIN
   INSERT INTO public.report_kinds(org_id,key,label) VALUES(target,'tenant_test','重複');
   RAISE EXCEPTION 'Duplicate key was accepted within a tenant';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 RAISE NOTICE 'PASS: preserved settings, foreign update=0, per-company unique key';
END $$;
-- 再適用も成功すること（コピーの追加やID変更がない）
\i supabase/migrations/163_report_kinds_tenant_scope.sql
