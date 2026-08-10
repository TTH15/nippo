-- ============================================================
-- 配達エリアをコースの属性として持つ
--   設計: docs/design/map-board.md §9 / roadmap A4-b
--
-- ユーザー合意（2026-08-10）: 「配達エリアは courses の属性」。
-- 拠点（map_places）は点・円のまま、**面（多角形）はコースが持つ**という切り分け。
-- 同じ「範囲」でも意味が違う: 拠点の円＝その場所の広がり、コースの面＝担当する区域。
--
-- delivery_area は GeoJSON の Polygon / MultiPolygon をそのまま入れる
--（PostGIS を入れずに済ませる。面積計算や内外判定が要るようになったら geography へ移行する）。
-- ============================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS delivery_area            jsonb,
  ADD COLUMN IF NOT EXISTS delivery_area_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_area_updated_by uuid REFERENCES drivers(id) ON DELETE SET NULL;

COMMENT ON COLUMN courses.delivery_area IS
  '配達エリア（GeoJSON Polygon / MultiPolygon）。地図で描いて保存する。NULL=未設定';
COMMENT ON COLUMN courses.delivery_area_updated_at IS '配達エリアの最終更新日時（誰がいつ引いたかを残す）';
