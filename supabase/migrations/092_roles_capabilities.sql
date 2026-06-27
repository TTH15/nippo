-- ============================================================
-- Phase 9 — 認可モデル（capability / role / permission）の基盤
-- 単一 role の3段ハードコード（DRIVER/ADMIN/ADMIN_VIEWER を requireAuth で固定階層）から、
-- 「固定 capability（コードが知る ~15 の can_*）＋ org が自由に作れる role（capability の束）」へ。
-- 本 migration は土台のみ＝追加・挙動不変（既存 requireAuth はそのまま動く）。
-- ルートの requirePermission 置換は後続（機微なものから段階移行）。
--   設計: docs/platform-design.md §2-6
-- ============================================================

-- ロール定義（org 単位。system 既定＋org が独自ロールを追加可）。
CREATE TABLE IF NOT EXISTS roles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES organizations(id),
  key        text        NOT NULL,                 -- 'ADMIN' 等。system は予約キー
  label      text        NOT NULL,                 -- 表示名（org が自由に）
  is_system  boolean     NOT NULL DEFAULT false,
  sort_order int         NOT NULL DEFAULT 0,       -- 表示・優先順位（運営が並べ替え）
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);
CREATE INDEX IF NOT EXISTS idx_roles_org_id ON roles (org_id);

-- ロールが持つ capability（コード側の固定集合 can_* を値で保持）。
CREATE TABLE IF NOT EXISTS role_capabilities (
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability text NOT NULL,                        -- 'can_view_rewards' 等
  PRIMARY KEY (role_id, capability)
);

-- membership（drivers）は role を参照。既存 drivers.role(text) は当面併存（表示・互換）。
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id);
CREATE INDEX IF NOT EXISTS idx_drivers_role_id ON drivers (role_id);

-- ---- 全 org に system 既定ロール4種を seed（冪等）----
INSERT INTO roles (org_id, key, label, is_system, sort_order)
SELECT o.id, v.key, v.label, true, v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('ADMIN',        '管理者',        10),
  ('ACCOUNTING',   '経理',          20),
  ('ADMIN_VIEWER', '管理者（閲覧）', 30),
  ('DRIVER',       'ドライバー',     40)
) AS v(key, label, sort_order)
ON CONFLICT (org_id, key) DO NOTHING;

-- ---- 既定 capability を system ロールへ付与（冪等）----
-- 設計 §2-6 の表どおり。DRIVER は admin ドメイン capability を持たない（自分の業務は別ゲート）。
INSERT INTO role_capabilities (role_id, capability)
SELECT r.id, d.capability
FROM roles r
JOIN (VALUES
  -- ADMIN: 全 capability
  ('ADMIN', 'can_view_reports'),
  ('ADMIN', 'can_edit_reports'),
  ('ADMIN', 'can_view_shifts'),
  ('ADMIN', 'can_manage_shifts'),
  ('ADMIN', 'can_view_rewards'),
  ('ADMIN', 'can_manage_rewards'),
  ('ADMIN', 'can_view_bank_accounts'),
  ('ADMIN', 'can_view_pii'),
  ('ADMIN', 'can_view_vehicles'),
  ('ADMIN', 'can_manage_vehicles'),
  ('ADMIN', 'can_view_billing'),
  ('ADMIN', 'can_manage_billing'),
  ('ADMIN', 'can_approve_members'),
  ('ADMIN', 'can_manage_members'),
  ('ADMIN', 'can_manage_org_settings'),
  -- ACCOUNTING: 閲覧全般＋報酬/請求の管理（PII・顔免許は不可）
  ('ACCOUNTING', 'can_view_reports'),
  ('ACCOUNTING', 'can_view_shifts'),
  ('ACCOUNTING', 'can_view_rewards'),
  ('ACCOUNTING', 'can_manage_rewards'),
  ('ACCOUNTING', 'can_view_bank_accounts'),
  ('ACCOUNTING', 'can_view_vehicles'),
  ('ACCOUNTING', 'can_view_billing'),
  ('ACCOUNTING', 'can_manage_billing'),
  -- ADMIN_VIEWER: 閲覧のみ（口座・PII は不可）
  ('ADMIN_VIEWER', 'can_view_reports'),
  ('ADMIN_VIEWER', 'can_view_shifts'),
  ('ADMIN_VIEWER', 'can_view_rewards'),
  ('ADMIN_VIEWER', 'can_view_vehicles'),
  ('ADMIN_VIEWER', 'can_view_billing')
) AS d(key, capability) ON d.key = r.key
WHERE r.is_system = true
ON CONFLICT (role_id, capability) DO NOTHING;

-- ---- 既存 drivers を text role → role_id にバックフィル（冪等）----
UPDATE drivers dr
SET role_id = r.id
FROM roles r
WHERE r.org_id = dr.org_id
  AND r.key = dr.role
  AND dr.role_id IS NULL;
