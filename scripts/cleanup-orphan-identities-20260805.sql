-- ============================================================
-- 孤児 identities の掃除（2026-08-05）
--
-- 原因: ドライバーの削除（DELETE /api/admin/users/[id]）が drivers 行しか消しておらず、
--   identities が残っていた。辻村さんを消して作り直した 6/23〜6/26 の作業で
--   同一人物の identity が8件でき、うち7件が孤児（driver 参照なし）になっていた。
--   コード側は修正済み（削除時に「参照なし・未検証・Passkeyなし」の identity も消す）。
--   このファイルは既存の残骸を片付けるもの。
--
-- 安全性: 消すのは以下をすべて満たす行だけ。
--   ・どの drivers からも参照されていない
--   ・phone_verified_at が null（検証済みの人物記録は残す）
--   ・passkey_credentials が無い
--   ・他テーブル（LINE連携・通知設定・push購読・platform）から参照されていない
--     → 参照があれば FK で削除が弾かれるので、①で件数を確認してから②を流すこと
--
-- ★本番DB操作。①→②→③の順に実行する。
-- ============================================================


-- ------------------------------------------------------------
-- ① 削除対象の確認（ここに出た行だけが消える）
-- ------------------------------------------------------------
SELECT i.id, i.name, i.phone, i.created_at
FROM identities i
WHERE NOT EXISTS (SELECT 1 FROM drivers d WHERE d.identity_id = i.id)
  AND i.phone_verified_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM passkey_credentials p WHERE p.identity_id = i.id)
ORDER BY i.created_at;


-- ------------------------------------------------------------
-- ② 削除
--    FK エラー（23503）が出たら、その identity は通知連携などから参照されている。
--    その場合は①の条件に該当行を除く条件を足して再実行する。
-- ------------------------------------------------------------
DELETE FROM identities i
WHERE NOT EXISTS (SELECT 1 FROM drivers d WHERE d.identity_id = i.id)
  AND i.phone_verified_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM passkey_credentials p WHERE p.identity_id = i.id);


-- ------------------------------------------------------------
-- ③ 結果の確認（孤児が0件になっていること／辻村さんが1件だけになっていること）
-- ------------------------------------------------------------
SELECT COUNT(*) AS remaining_orphans
FROM identities i
WHERE NOT EXISTS (SELECT 1 FROM drivers d WHERE d.identity_id = i.id);

SELECT i.id, i.name, i.phone, i.phone_verified_at, d.name AS driver_name, d.status
FROM identities i
LEFT JOIN drivers d ON d.identity_id = i.id
WHERE regexp_replace(COALESCE(i.phone, ''), '\D', '', 'g') LIKE '%8085274632';
