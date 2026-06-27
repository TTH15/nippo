-- ============================================================
-- 2段階承認 — 本人確認（本承認）の状態。
-- ①仮承認(pending→active) の後、ドライバーが本登録(免許/顔/住所/銀行)を提出。
-- 運営が顔・免許を目視確認して「本承認」した時刻を記録する。
-- kyc_verified_at が NULL の間はアプリ本体を解放しない（mobile ハードゲート）。
--   設計: docs/platform-design.md §2-2（承認＝顔・免許の目視確認）
-- ============================================================

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS kyc_verified_at timestamptz;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS kyc_verified_by uuid;
