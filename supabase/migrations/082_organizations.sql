-- ============================================================
-- マルチテナント移行 Phase 0 — テナント表の正式化
-- 既存 companies を organizations へ昇格し、テナントの内部キー(id=org_id)・
-- 参加コード(join_code)・表示コード(code=旧company_code)・状態(status)を整える。
-- 追加のみ・挙動変更なし。冪等。
--   設計: docs/platform-design.md §6,§7 / docs/platform-overview.md §7
-- ============================================================

-- 1) companies -> organizations へリネーム（冪等: 既に済なら何もしない）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'companies')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'organizations') THEN
    ALTER TABLE companies RENAME TO organizations;
  END IF;
END $$;

-- 2) テナント運用に必要な列を追加
--    code          : 表示用の会社コード（旧 company_code。既存列をそのまま流用）
--    join_code     : ドライバー参加用の招待コード（再生成可・漏洩時は作り直す）
--    status        : pending / active / suspended（既存テナントは active）
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS join_code text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- join_code は採番済のものだけ一意（NULL は許容）
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_join_code
  ON organizations (join_code) WHERE join_code IS NOT NULL;

-- 3) 本番テナント（ACE）の行を保証
INSERT INTO organizations (code, name, status)
VALUES ('ACE', '株式会社ACE CREATION', 'active')
ON CONFLICT (code) DO NOTHING;

-- 4) ACE に join_code を採番（未採番のときのみ。運用側でいつでも再生成可）
UPDATE organizations
SET join_code = 'ACE001'
WHERE code = 'ACE' AND join_code IS NULL;
