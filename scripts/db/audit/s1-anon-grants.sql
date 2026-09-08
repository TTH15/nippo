-- S-1: anon / authenticated ロールに残っている DB 権限の棚卸し（読み取りのみ）
--
--   実行: scripts/db/db.sh qf scripts/db/audit/s1-anon-grants.sql
--   目的: share-session が配る anon key で「何がどこまで読めるのか」を、
--         権限（GRANT）と RLS の両面から確定させる。結果は docs/security/ に残す。
--
-- 判定の読み方:
--   ・GRANT が残っていて RLS 無効     → その anon key を持つ全員が全行を読める（最悪）
--   ・GRANT が残っていて RLS 有効     → 今は止まっているが、policy 1本の追加で開く（要 REVOKE）
--   ・GRANT が無い                    → PostgREST は 401。守られている

\echo '=== 0. 接続先と PostgREST が公開しているスキーマ ==='
select current_database() as db,
       current_user       as connected_as,
       version()          as pg_version;

select rolname,
       rolconfig
  from pg_roles
 where rolname in ('authenticator','anon','authenticated','service_role')
 order by rolname;

\echo ''
\echo '=== 1. anon / authenticated のスキーマ権限 ==='
select n.nspname as schema,
       has_schema_privilege('anon',          n.oid, 'USAGE')  as anon_usage,
       has_schema_privilege('authenticated', n.oid, 'USAGE')  as authed_usage
  from pg_namespace n
 where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
 order by n.nspname;

\echo ''
\echo '=== 2. public のテーブルごとの権限と RLS（要注意行だけ） ==='
select c.relname as table_name,
       c.relrowsecurity  as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies,
       string_agg(distinct g.privilege_type, ',' order by g.privilege_type)
         filter (where g.grantee = 'anon')          as anon_privs,
       string_agg(distinct g.privilege_type, ',' order by g.privilege_type)
         filter (where g.grantee = 'authenticated') as authed_privs
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join information_schema.role_table_grants g
         on g.table_schema = 'public'
        and g.table_name   = c.relname
        and g.grantee in ('anon','authenticated','PUBLIC')
 where n.nspname = 'public'
   and c.relkind in ('r','v','m','p','f')
 group by c.relname, c.relrowsecurity, c.relforcerowsecurity
 order by (string_agg(distinct g.privilege_type, ',') filter (where g.grantee='anon') is not null) desc,
          c.relrowsecurity,
          c.relname;

\echo ''
\echo '=== 3. 集計: anon に権限が残っている数 / RLS で守られている数 ==='
with t as (
  select c.relname,
         c.relrowsecurity as rls,
         exists (select 1 from information_schema.role_table_grants g
                  where g.table_schema='public' and g.table_name=c.relname
                    and g.grantee='anon' and g.privilege_type='SELECT') as anon_select
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p','v','m')
)
select count(*)                                          as tables_total,
       count(*) filter (where anon_select)               as anon_can_select,
       count(*) filter (where anon_select and not rls)   as anon_select_no_rls_危険,
       count(*) filter (where anon_select and rls)       as anon_select_with_rls,
       count(*) filter (where not anon_select)           as anon_blocked
  from t;

\echo ''
\echo '=== 4. 関数の EXECUTE 権限（anon / authenticated / PUBLIC） ==='
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       array_to_string(p.proacl, E'\n')          as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proacl is null  -- null = 既定（PUBLIC に EXECUTE）
        or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee in ('anon'::regrole, 'authenticated'::regrole, 0)
                      and a.privilege_type = 'EXECUTE'))
 order by p.prosecdef desc, p.proname;

\echo ''
\echo '=== 5. シーケンス権限 ==='
select c.relname,
       array_to_string(c.relacl, E'\n') as acl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='S'
   and (c.relacl is null or array_to_string(c.relacl, ' ') like '%anon%'
                          or array_to_string(c.relacl, ' ') like '%authenticated%')
 order by c.relname;

\echo ''
\echo '=== 6. DEFAULT PRIVILEGES（今後作る表に自動で付く権限） ==='
select pg_get_userbyid(d.defaclrole) as granted_by,
       n.nspname                     as schema,
       d.defaclobjtype               as obj_type,
       array_to_string(d.defaclacl, E'\n') as acl
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
 order by 1,2,3;

\echo ''
\echo '=== 7. storage / auth スキーマへの anon 権限（参考） ==='
select g.table_schema, g.table_name, g.grantee,
       string_agg(distinct g.privilege_type, ',' order by g.privilege_type) as privs
  from information_schema.role_table_grants g
 where g.grantee in ('anon','authenticated')
   and g.table_schema in ('storage','auth','graphql_public','extensions')
 group by 1,2,3
 order by 1,2,3;
