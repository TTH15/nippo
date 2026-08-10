-- ============================================================
-- 駐車区画（parking_slots）
--   設計: docs/design/map-ux.md §3・§6
--
-- 拠点（map_places）の中には区画が複数ある（「サンパルク伏見桃山 12番」）。
-- 1行では表せないので区画を別テーブルにする。
--
-- ・geometry は矩形（GeoJSON Polygon・閉じた5点）。航空写真を見ながら実際の区画に合わせて描く
-- ・bearing は**人に指定させず**、矩形の長辺から自動算出する（2026-08-10 ユーザー判断）。
--   前後どちら向きに停まっているかまでは決めない。区画に沿っていれば十分
-- ・vehicle_id は「この区画がその車の定位置」を表す。**出発地**（稼働開始を押す場所）の正体であり、
--   ドライバーの「今日の車どこ？」と、未出勤のゴーストピンの立ち位置に使う
-- ============================================================

CREATE TABLE IF NOT EXISTS parking_slots (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL,
  place_id   uuid        NOT NULL REFERENCES map_places(id) ON DELETE CASCADE,
  label      text        NOT NULL,              -- 「12番」
  geometry   jsonb       NOT NULL,              -- GeoJSON Polygon（矩形）
  bearing    real        NOT NULL DEFAULT 0,    -- 車体の軸（度・北=0）。矩形の長辺から自動算出
  lat        double precision NOT NULL,         -- 代表点（矩形の中心）。距離計算・ピン表示に使う
  lng        double precision NOT NULL,
  vehicle_id uuid        REFERENCES vehicles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE parking_slots IS '駐車区画。拠点の中の1台分。出発地（稼働開始を押す場所）の正体';
COMMENT ON COLUMN parking_slots.bearing IS '車体の軸（度）。矩形の長辺から自動算出。人に指定させない';
COMMENT ON COLUMN parking_slots.vehicle_id IS 'この区画の定位置の車両。ドライバーの「今日の車どこ？」に答えるための紐付け';

CREATE INDEX IF NOT EXISTS idx_parking_slots_place ON parking_slots (place_id);
CREATE INDEX IF NOT EXISTS idx_parking_slots_org ON parking_slots (org_id);
-- 1台の車の定位置は高々1つ（貸出や入替で変わるが、同時に2区画は持たない）
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_slots_vehicle
  ON parking_slots (vehicle_id) WHERE vehicle_id IS NOT NULL;
