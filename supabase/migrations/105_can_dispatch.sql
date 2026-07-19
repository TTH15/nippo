-- ============================================================
-- A1 — 配車（車両割当）権限の切り分け（roadmap-2026-07 A1）
-- シフト upsert（can_manage_shifts）に同梱されていた車両割当を
-- 独立 capability `can_dispatch` へ分離する。
--   - 新ガード: POST /api/admin/shifts/vehicle・vehicle-loans
--   - これにより「シフト閲覧＋配車のみ」の配車担当ロールが作れる
-- 既存挙動の維持のため、can_manage_shifts を持つ全ロール（system ADMIN・
-- custom 問わず）へ can_dispatch を付与する。追加のみ・冪等。
-- コード側の正本は server/auth/capabilities.ts。
--   設計: docs/platform-design.md §2-6
-- ============================================================

INSERT INTO role_capabilities (role_id, capability)
SELECT rc.role_id, 'can_dispatch'
FROM role_capabilities rc
WHERE rc.capability = 'can_manage_shifts'
ON CONFLICT (role_id, capability) DO NOTHING;
