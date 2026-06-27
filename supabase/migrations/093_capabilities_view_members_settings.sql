-- ============================================================
-- Phase 9 — capability カタログ追補（can_view_members / can_view_org_settings）
-- PR-2 のルート移行で判明した「読み取り用 capability の不足」を補う。
--   can_view_members      : ドライバー名簿(users GET)の閲覧（経理も名簿が要る）
--   can_view_org_settings : コース/単価/キャリア等 設定の閲覧（日報画面等がコース名で参照）
-- 既存 system ロールの ADMIN/ACCOUNTING/ADMIN_VIEWER に付与（VIEWER の現状の読み取りを維持）。
-- 追加のみ・冪等。コード側の正本は server/auth/capabilities.ts。
--   設計: docs/platform-design.md §2-6
-- ============================================================

INSERT INTO role_capabilities (role_id, capability)
SELECT r.id, d.capability
FROM roles r
JOIN (VALUES
  ('ADMIN',        'can_view_members'),
  ('ADMIN',        'can_view_org_settings'),
  ('ACCOUNTING',   'can_view_members'),
  ('ACCOUNTING',   'can_view_org_settings'),
  ('ADMIN_VIEWER', 'can_view_members'),
  ('ADMIN_VIEWER', 'can_view_org_settings')
) AS d(key, capability) ON d.key = r.key
WHERE r.is_system = true
ON CONFLICT (role_id, capability) DO NOTHING;
