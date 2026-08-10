-- ============================================================
-- 拠点を「点」だけでなく「範囲」でも登録できるようにする
--   設計: docs/design/map-board.md
--
-- ユーザー要望（2026-08-10）: 登録した地点の移動・名称変更ができるようにしたい。
-- また「点ではなく範囲で登録したい場合もある」（センターの敷地・駐車場・配達エリア）。
--
-- 段階を分ける:
--   ・shape='point'  … 従来どおり1点（既存行はこれ）
--   ・shape='circle' … 中心＋半径。敷地や「この辺り」を表すのに十分で、UI が軽い
--   ・shape='polygon'… 任意の多角形（配達エリア）。描画ツールが要るので後段
--
-- lat/lng は shape に関わらず「代表点」として持ち続ける（ピン表示・距離計算に使う）。
-- polygon の形状は geometry(jsonb) に GeoJSON Polygon で持つ。
-- ============================================================

ALTER TABLE map_places
  ADD COLUMN IF NOT EXISTS shape    text NOT NULL DEFAULT 'point',
  ADD COLUMN IF NOT EXISTS radius_m integer,
  ADD COLUMN IF NOT EXISTS geometry jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'map_places_shape_check'
  ) THEN
    ALTER TABLE map_places
      ADD CONSTRAINT map_places_shape_check CHECK (shape IN ('point', 'circle', 'polygon'));
  END IF;
END $$;

COMMENT ON COLUMN map_places.shape IS 'point=1点 / circle=中心+半径 / polygon=多角形（geometry に GeoJSON）';
COMMENT ON COLUMN map_places.radius_m IS 'shape=circle のときの半径（m）';
COMMENT ON COLUMN map_places.geometry IS 'shape=polygon のときの GeoJSON Polygon';
