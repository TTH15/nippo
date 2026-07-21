-- ============================================================
-- 車両の金額情報を独立 capability へ切り出す（roadmap-2026-07 F）
-- 従来は can_view_vehicles だけで購入費用・リース代・保険料・初期費用回収まで
-- 全部見えていた。配車担当（can_dispatch）に車両閲覧を与えると金額も見えてしまうため、
-- 閲覧を `can_view_vehicle_cost` に分離する（編集は従来どおり can_manage_vehicles）。
--
-- 既存挙動の維持: 現在 can_view_vehicles を持つ全ロールへ付与する。
-- これにより「今まで見えていた人は引き続き見える」状態から始まり、
-- 運営が配車担当ロールから外す運用ができる。追加のみ・冪等。
-- コード側の正本は server/auth/capabilities.ts。
--   設計: docs/platform-design.md §2-6
-- ============================================================

INSERT INTO role_capabilities (role_id, capability)
SELECT rc.role_id, 'can_view_vehicle_cost'
FROM role_capabilities rc
WHERE rc.capability = 'can_view_vehicles'
ON CONFLICT (role_id, capability) DO NOTHING;
