-- ============================================================
-- マルチテナント Phase 5b — identity / membership の整合性をDB制約で固める
-- 「1人=1 identity」「1人×1組織=高々1所属」「経理ロール」をアプリ任せにせず、
-- DB レベルの不変条件として強制する。複数組織所属を本番投入する前提条件。
-- 追加のみ・挙動不変（既存の正常データには影響しない）。冪等。
--   設計: docs/platform-design.md §2-0, §2-2 / レビュー指摘 1・2・3
--   対になるアプリ変更: apps/web/src/app/api/join/route.ts の find-or-create 冪等化
-- ============================================================

-- ------------------------------------------------------------
-- 制約1) identities.phone を「検証済みのうちは一意」にする
--   ＝ SMS OTP 検証済み(phone_verified_at IS NOT NULL)の電話は1人=1 identity。
--   未検証(legacy backfill 等)は対象外＝移行を壊さない。NULL phone も対象外。
--   これが無いと join の find-or-create が並行/重複で二重 identity を作り、
--   2社目を別 identity にぶら下げて「会社切替できない」事故になる。
-- ------------------------------------------------------------

-- 事前検査: 検証済み phone に重複があると下の index 作成が失敗するので、
-- 先に件数を数えて分かりやすく落とす（手動解消を促す）。
DO $$
DECLARE
  dup_count int;
  sample    text;
BEGIN
  SELECT count(*), min(phone) INTO dup_count, sample
  FROM (
    SELECT phone
    FROM identities
    WHERE phone IS NOT NULL AND phone_verified_at IS NOT NULL
    GROUP BY phone
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      '検証済み電話が重複した identity が % 件あります(例: %)。'
      '同一人物のはずなので membership(drivers.identity_id) を残す側へ寄せ、'
      '余分な identity を統合・削除してから再実行してください。',
      dup_count, sample;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_phone_verified
  ON identities (phone)
  WHERE phone IS NOT NULL AND phone_verified_at IS NOT NULL;

-- ------------------------------------------------------------
-- 制約2) drivers(identity_id, org_id) を「却下以外は一意」にする
--   ＝ 同じ人は同じ会社に高々1所属(Slackモデル)。
--   却下(rejected)は履歴として複数残せる＆再申請(pending)と共存できるよう除外。
--   identity_id 未設定の行(テスト用や移行途中)は対象外＝壊さない。
-- ------------------------------------------------------------

-- 事前検査: 却下以外で (identity_id, org_id) が重複していれば落とす。
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT identity_id, org_id
    FROM drivers
    WHERE identity_id IS NOT NULL AND status <> 'rejected'
    GROUP BY identity_id, org_id
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      '同一 identity × 同一 org の有効な membership が % 組重複しています。'
      '1人×1社=1所属に統合(余分な drivers 行を rejected か削除)してから再実行してください。',
      dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_identity_org_active
  ON drivers (identity_id, org_id)
  WHERE identity_id IS NOT NULL AND status <> 'rejected';

-- ------------------------------------------------------------
-- 制約3) drivers.role に ACCOUNTING(経理) を追加
--   背景に経理担当が明記されているのに enum に無かった。既存値は不変。
--   DROP→ADD で冪等(再実行しても同じ CHECK に収束)。
-- ------------------------------------------------------------
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_role_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_role_check
  CHECK (role IN ('DRIVER', 'ADMIN', 'ADMIN_VIEWER', 'ACCOUNTING'));
