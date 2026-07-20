-- ============================================================
-- ロール「経理（ACCOUNTING）」を system 既定から外す。
-- 既定ロールとして常設する必要がないという運用判断（2026-07-20）。
-- 行は消さない（メンバーが割り当て済みの org があり得るため）。is_system=false にすると
-- 通常のカスタムロールと同じ扱いになり、UI 上で並べ替え・改名・削除ができる。
-- capability の束（role_capabilities）はそのまま維持する。
-- コード側の DEFAULT_ROLE_CAPABILITIES.ACCOUNTING は role_id 未設定データの
-- フォールバックとして残す（挙動不変）。
-- ============================================================

UPDATE roles
SET is_system = false
WHERE key = 'ACCOUNTING'
  AND is_system = true;
