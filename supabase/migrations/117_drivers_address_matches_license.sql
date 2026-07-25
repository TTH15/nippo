-- ============================================================
-- 住所の本人申告フラグ（§2-1a 初期登録・住所ステップ）
-- 「入力した住所は運転免許証の記載と同じ」のチェック値。
-- true=免許記載どおり / false=引越し等で異なる（運営が承認時に確認する）
-- NULL=未申告（この機能より前の登録・admin 手入力）。membership 単位（drivers）。
-- ============================================================

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS address_matches_license boolean;

COMMENT ON COLUMN drivers.address_matches_license IS
  '本人申告: 住所が免許証記載と同一か（/join 住所ステップ）。NULL=未申告';
