-- 159: anon / authenticated から public・storage の権限を剥がす（S-1）
--
-- 背景（docs/security/2026-09-08-s1-anon-grants.md）:
--   本番の public 94 テーブルのうち 90 で anon と authenticated が
--   SELECT/INSERT/UPDATE/DELETE/TRUNCATE を保持している。いま行が漏れていないのは
--   イベントトリガ rls_auto_enable が全テーブルの RLS を有効にしており、policy が
--   1 本も無いため。つまり policy を 1 本足す・RLS が 1 つ外れる、のどちらかで
--   anon キー（share-session で運営のブラウザに渡している）が全社データの
--   読み書きに使えてしまう。権限そのものを落として、RLS を最後の砦ではなくする。
--
-- 触らないもの: service_role の権限（アプリはこれ 1 本で動く）。
--               public スキーマの USAGE（PostgREST の接続に要る）。
-- 冪等: REVOKE / GRANT はいずれも再実行して安全。

-- REVOKE は各テーブルに ACCESS EXCLUSIVE ロックを取る。長いクエリと衝突したら
-- 待ち続けずに中止する（1トランザクションなので全部巻き戻る）。
SET LOCAL lock_timeout = '3s';

-- 1) public のテーブル・シーケンス
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 2) public の関数・プロシージャ
--    proacl に "=X/postgres"（PUBLIC への EXECUTE）が残っている関数があり、
--    anon は PUBLIC の一員なので PUBLIC からも剥がさないと実行できてしまう。
--    public スキーマに拡張は入っていない（pgcrypto 等は extensions スキーマ）ため、
--    ここで PUBLIC を剥がしても外部の関数は巻き込まない。
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- 3) service_role は従来どおり全権（既に持っているが明示して取りこぼしを防ぐ）
GRANT ALL     ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL     ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL ROUTINES  IN SCHEMA public TO service_role;

-- 4) 接続に必要な USAGE は残す（テーブル権限が無いので中身は見えない）
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 5) 今後 postgres が作るオブジェクトに権限が付かないようにする
--    （既定では public / storage の新規テーブルに anon の全権限が自動で付く）
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 6) storage も同様に。所有者が supabase_storage_admin のため postgres では
--    剥がせない場合があるので、失敗しても migration 全体は止めない。
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA storage FROM anon, authenticated';
  RAISE NOTICE '159: storage のテーブル権限を REVOKE しました';
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE '159: storage のテーブル権限は postgres では剥がせません（ダッシュボード側で対応）';
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 既知の残り: supabase_admin が持つ public の DEFAULT PRIVILEGES（テーブル・関数・
-- シーケンスに anon / authenticated の全権限を付ける）は postgres では取り消せない
--   ERROR: permission denied to change default privileges
-- migration もダッシュボードの SQL Editor も postgres で走るため実害は無いが、
-- supabase_admin が public にテーブルを作った場合だけ権限が復活する。
-- テーブルを追加する migration のあとは
--   scripts/db/db.sh qf scripts/db/audit/s1-anon-grants.sql
-- で 3. の集計（anon_can_select = 0）を確認すること。
