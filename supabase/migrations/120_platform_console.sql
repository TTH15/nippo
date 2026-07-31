-- ============================================================
-- プラットフォームコンソール Phase 1（docs/platform-design.md §2-5 の実務ツール化）
--   - platform_admins: プラットフォーム運営者（identity 基準・org の membership とは別軸）
--   - org_applications: 運営社オンボーディング申請（公開フォーム /apply から投稿、審査→承認で org 発行）
--   - platform_audit_logs: プラットフォーム操作の監査ログ（「デフォルトで見えない・見る時は記録が残る」の土台）
-- Phase 1 のコンソールは集計のみ・PII なし。テナント個別データへの break-glass は Phase 2。
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_admins (
  identity_id uuid        PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  note        text,
  granted_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE platform_admins IS 'プラットフォーム運営者。org membership と独立に identity へ付与（/platform の入場資格）';

CREATE TABLE IF NOT EXISTS org_applications (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name     text        NOT NULL,
  corporate_number text,                          -- 法人番号（13桁・国税庁照合は審査時に手動）
  representative   text,                          -- 代表者名
  contact_name     text,                          -- 申請担当者名
  contact_email    text        NOT NULL,
  contact_phone    text,
  address          text,
  message          text,                          -- 申請時の自由記入
  status           text        NOT NULL DEFAULT 'pending',  -- pending / reviewing / approved / rejected
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       uuid REFERENCES identities(id) ON DELETE SET NULL,
  decided_note     text,                          -- 審査メモ（否認理由等）
  org_id           uuid REFERENCES organizations(id) ON DELETE SET NULL  -- 承認時に発行した org
);
CREATE INDEX IF NOT EXISTS idx_org_applications_status_created ON org_applications (status, created_at DESC);
COMMENT ON TABLE org_applications IS '運営社オンボーディング申請（§2-5 KYB ハイタッチフローの受付台帳）。承認＝org ブートストラップ';

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_identity_id uuid REFERENCES identities(id) ON DELETE SET NULL,
  action            text        NOT NULL,          -- 'org.create' / 'application.approve' 等
  target            text,                          -- 対象の識別子（org_id / application_id 等）
  detail            jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created ON platform_audit_logs (created_at DESC);
COMMENT ON TABLE platform_audit_logs IS 'プラットフォーム操作の監査ログ。テナントデータに触れる操作は必ずここに記録する';
