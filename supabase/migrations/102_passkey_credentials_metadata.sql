-- ============================================================
-- Phase 6b — Passkey(WebAuthn) 実装用メタデータ列
-- migration 088 で作成した passkey_credentials は最小限(id/identity_id/credential_id/
-- public_key/counter)だったため、登録時のクライアント情報・利用状況を保持する列を追加する。
-- 追加のみ・既存挙動不変。
-- ============================================================

ALTER TABLE passkey_credentials ADD COLUMN IF NOT EXISTS transports text[];
ALTER TABLE passkey_credentials ADD COLUMN IF NOT EXISTS device_type text;
ALTER TABLE passkey_credentials ADD COLUMN IF NOT EXISTS backed_up boolean;
ALTER TABLE passkey_credentials ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE passkey_credentials ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
