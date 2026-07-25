-- ============================================================
-- 利用規約・プライバシーポリシーへの同意記録（§2-1a 初期登録）
-- 同意は人（identity）単位。/api/join で termsAgreed=true を必須にし、
-- SMS 検証成功時（＝申請確定時）のタイムスタンプを刻む。
-- 再申請・別 org 参加で同意し直した場合は最新の同意時刻で上書きする。
-- ============================================================

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS terms_agreed_at timestamptz;

COMMENT ON COLUMN identities.terms_agreed_at IS
  '利用規約・プライバシーポリシーへの最終同意日時（/join 申請時に記録）';
