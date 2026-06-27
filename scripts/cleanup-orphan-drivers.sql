-- ============================================================
-- 重複/孤児ドライバー行のクリーンアップ
--
-- 重要: FK 制約 drivers_identity_id_fkey のため、必ず
--   「drivers を先に削除 → identities を後で削除」の順にすること。
--   （identities を先に消すと drivers から参照中で 23503 エラーになる）
--
-- driver_identities / driver_courses は drivers への ON DELETE CASCADE なので
--   drivers を消せば自動で消える。
--
-- ★本番DB操作。BEGIN〜COMMIT で囲み、件数を確認してから COMMIT すること。
-- ============================================================


-- ============================================================
-- 【A】辻村菜都美 を全削除する（ユーザー指示: 全部消してOK・作り直す）
--   Supabase SQL Editor は実行ごとに自動コミットするので、BEGIN/COMMIT も
--   TEMP テーブルも使わず、①→② を順に実行するだけでよい。
-- ============================================================

-- A-1: 対象確認（消える行の一覧）
SELECT id, name, driver_code, status, identity_id, created_at
FROM drivers WHERE name LIKE '%辻村%' ORDER BY created_at;

-- A-① drivers を削除（driver_identities / driver_courses は CASCADE で道連れ）
DELETE FROM drivers WHERE name LIKE '%辻村%';

-- A-② 参照が外れた辻村の identities を削除
DELETE FROM identities
WHERE name LIKE '%辻村%'
  AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.identity_id = identities.id);

-- A-確認（どちらも 0 になるはず）
SELECT count(*) AS drivers_left    FROM drivers    WHERE name LIKE '%辻村%';
SELECT count(*) AS identities_left FROM identities WHERE name LIKE '%辻村%';


-- ============================================================
-- 【B】汎用: 「driver_identities を1件も持たない DRIVER 行」＝保存失敗の孤児を一掃
--    （辻村以外にも同じ残骸があれば、これで掃除できる。正規ドライバーは必ず
--     slot1 の driver_identities を持つので残る）
-- ============================================================

-- B-1: 孤児ドライバー確認
SELECT d.id, d.name, d.driver_code, d.org_id, d.status, d.identity_id, d.created_at
FROM drivers d
WHERE d.role = 'DRIVER'
  AND NOT EXISTS (SELECT 1 FROM driver_identities di WHERE di.driver_id = d.id)
ORDER BY d.name, d.created_at;

-- B-2: 削除（順序: drivers → identities）
BEGIN;
  CREATE TEMP TABLE _orphan_ids ON COMMIT DROP AS
    SELECT d.id AS driver_id, d.identity_id
    FROM drivers d
    WHERE d.role = 'DRIVER'
      AND NOT EXISTS (SELECT 1 FROM driver_identities di WHERE di.driver_id = d.id);

  DELETE FROM drivers WHERE id IN (SELECT driver_id FROM _orphan_ids);

  DELETE FROM identities i
  WHERE i.id IN (SELECT identity_id FROM _orphan_ids WHERE identity_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.identity_id = i.id);

-- COMMIT;
-- ROLLBACK;
