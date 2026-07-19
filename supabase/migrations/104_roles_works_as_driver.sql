-- ============================================================
-- Phase 9 続き — 「ドライバーとして扱う」フラグ（works_as_driver）。
-- 権限を持つメンバー（管理者等）もドライバーとして稼働できるようにする応急処置。
-- 従来「role = 'DRIVER'」ハードコードだったシフト・名簿等のドライバー抽出を
-- このフラグに置き換える（役割=ロール、稼働可否=フラグ、の直交化）。
--
-- roles.works_as_driver が設定の正本。drivers.works_as_driver は抽出クエリ用の
-- 非正規化コピーで、ロール割当時・ロール設定変更時にアプリ側で同期する
-- （drivers.role テキストと role_id の同期と同じパターン）。
--   設計: docs/platform-design.md §2-6
-- ============================================================

ALTER TABLE roles ADD COLUMN IF NOT EXISTS works_as_driver boolean NOT NULL DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS works_as_driver boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_drivers_org_works_as_driver ON drivers (org_id, works_as_driver);

-- system の DRIVER ロールは常にドライバー稼働（UI でも固定 ON）
UPDATE roles SET works_as_driver = true WHERE key = 'DRIVER' AND is_system = true;

-- ---- 既存 drivers へバックフィル（冪等）----
-- role_id が張られていればロール設定から、未設定（旧データ）は role テキストで判定
UPDATE drivers dr
SET works_as_driver = true
FROM roles r
WHERE dr.role_id = r.id
  AND r.works_as_driver = true
  AND dr.works_as_driver = false;

UPDATE drivers
SET works_as_driver = true
WHERE role_id IS NULL
  AND role = 'DRIVER'
  AND works_as_driver = false;
