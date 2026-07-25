-- ============================================================
-- 単回招待リンク（§2-1a 一本化フロー / §7 Phase 9 の invites エンティティを前倒し）
-- 運営が個人宛に発行する使い切りトークン。/join?invite=<token> で開くと
-- 会社名が確認でき、SMS 認証成功時に1回だけ消費される。
-- 共有 join_code（口頭伝達フォールバック）は併存。
--
-- 消費は「used_at IS NULL の行だけを条件付き UPDATE」で行い、二重使用を防ぐ。
-- 仮承認の自動化は不要（承認は KYC 目視込みの1回に統合済み＝§2-1a）。
-- ============================================================

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  -- 宛先メモ（運営の管理用ラベル。本人には表示せず、氏名は必ず本人が入力する）
  name text,
  created_by uuid REFERENCES drivers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_identity uuid REFERENCES identities(id) ON DELETE SET NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_invites_org_created ON invites (org_id, created_at DESC);

COMMENT ON TABLE invites IS '単回招待リンク（/join?invite=token）。used_at 条件付きUPDATEで1回だけ消費';
