-- ============================================================
-- マルチテナント Phase 5a — identity（人）層の抽出
-- identity = 顔・免許・氏名・生年月日・電話・Passkey・LINE で確定する「この人」（1人=1つ・グローバル）。
-- 既存 drivers 行は membership（所属）として温存し、drivers.identity_id で 1:1 紐付け。
-- 追加のみ・挙動不変（読み書きの正本は drivers のまま。読み替え/Passkey は Phase 6、参加フローは Phase 7）。
-- ※ identities（人）は既存 driver_identities（勤務区分slot）とは完全に別物。
--   設計: docs/platform-design.md §1, §6, Phase 5
-- ============================================================

-- アイデンティティ層（人単位・KYC・認証）
CREATE TABLE IF NOT EXISTS identities (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text,
  dob                date,
  phone              text,
  phone_verified_at  timestamptz,                 -- SMS OTP で検証（Phase 6）
  face_photo_path    text,
  license_photo_path text,
  license_expiry     date,
  line_user_id       text        UNIQUE,           -- 統合公式の友だち追加で取得（identity 単位）
  pin_hash           text,                          -- Phase 6 で Passkey に置換予定の橋渡し
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- WebAuthn 資格情報（Phase 6 で使用。今は空）
CREATE TABLE IF NOT EXISTS passkey_credentials (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id   uuid        NOT NULL REFERENCES identities(id),
  credential_id text        UNIQUE,
  public_key    bytea,
  counter       bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_identity ON passkey_credentials (identity_id);

-- drivers 行 = membership。identity へ紐付け＋承認状態
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS identity_id uuid REFERENCES identities(id);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- status は pending/active/rejected のみ（既存全行＝active＝挙動不変。Phase 7 で運用）
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_status_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_status_check CHECK (status IN ('pending', 'active', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_drivers_identity_id ON drivers (identity_id);

-- 既存 driver を 1:1 で identity に backfill（冪等）。
-- identity_id 未設定の行のみ対象＝再実行は no-op（identity を重複作成しない）。
-- 氏名・電話・免許・LINE・PIN を人単位の属性として identities へ移送（drivers にも当面残す）。
DO $$
DECLARE
  r       record;
  new_id  uuid;
BEGIN
  FOR r IN SELECT id, name, phone, license_expiry_date, line_user_id, pin_hash
           FROM drivers WHERE identity_id IS NULL
  LOOP
    INSERT INTO identities (name, phone, license_expiry, line_user_id, pin_hash)
    VALUES (r.name, r.phone, r.license_expiry_date, r.line_user_id, r.pin_hash)
    RETURNING id INTO new_id;

    UPDATE drivers SET identity_id = new_id WHERE id = r.id;
  END LOOP;
END $$;
