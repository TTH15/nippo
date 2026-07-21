-- ============================================================
-- 車両画像の表示位置（フォーカスポイント）
-- 一覧のサムネイルは 16:9 に object-cover で切り取るため、
-- 縦長写真などで見せたい部分（ナンバー・車体）が枠外に出てしまう。
-- 「どこを中心に表示するか」を車両ごとに持たせて、運営が選べるようにする。
--
-- 値は CSS の object-position と同じ 0〜100（%）。既定は中央（50/50）＝現行の見え方。
-- ============================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_focus_x smallint NOT NULL DEFAULT 50;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_focus_y smallint NOT NULL DEFAULT 50;

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_image_focus_x_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_image_focus_x_check
  CHECK (image_focus_x BETWEEN 0 AND 100);
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_image_focus_y_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_image_focus_y_check
  CHECK (image_focus_y BETWEEN 0 AND 100);
