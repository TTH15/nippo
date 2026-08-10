-- ============================================================
-- 地図の車両3Dモデル: 車種と車体色を車両ごとに持つ
--   設計: docs/design/map-board.md / docs/assets-todo.md
--
-- ユーザー方針（2026-08-10）: NISSAN Clipper・スズキ エブリイなど代表的な軽バンを
-- **色変更できる形**で用意し、車両ごとに選べるようにする。
-- モデル本体は静的アセット（/models/*.glb）、どれを使うかは車両の属性として持つ。
--
-- model_key は「アプリが知っているモデルの識別子」。未設定なら既定モデルで描く。
-- body_color は #RRGGBB。未設定ならモデル本来の色（テクスチャ）をそのまま使う。
-- ============================================================

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS model_key  text,
  ADD COLUMN IF NOT EXISTS body_color text;

COMMENT ON COLUMN vehicles.model_key IS
  '地図の3Dモデル識別子（例: clipper / every / default）。NULL=既定モデル';
COMMENT ON COLUMN vehicles.body_color IS
  '車体色 #RRGGBB。NULL=モデル本来の色。model-color で着色するためモデル側は無彩色が望ましい';
