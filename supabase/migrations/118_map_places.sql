-- ============================================================
-- 地図（ベータ）の拠点ピン
-- 運営が地図上にピンを打ち、名称とマーカー種別を付けて保存する。
-- ページにハードコードしていた拠点定数の置き換え。org（テナント）単位。
-- ============================================================

CREATE TABLE IF NOT EXISTS map_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  icon text NOT NULL DEFAULT 'pin',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_map_places_org ON map_places (org_id);

COMMENT ON TABLE map_places IS '地図（ベータ）の拠点ピン。運営が任意に追加・削除する';
COMMENT ON COLUMN map_places.icon IS 'マーカー種別: pin / warehouse / parking / client';
