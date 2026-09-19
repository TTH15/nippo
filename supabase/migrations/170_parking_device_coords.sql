-- ============================================================
-- 端末の測位による駐車申告（2026-09-17）。設計: docs/design/mobile-parking-auto-detect.md §2-4 / §5
--
-- これまで kind='parked' は「登録車庫か場所名」が必須だった。モバイルは車庫マスタを持たず
-- 座標だけを送るので、座標だけの申告も有効にする（どの車庫かはサーバーが決める）。
-- 測位の水平精度と、その座標をどうやって得たかを別の列で残す。精度は「その座標がどれだけ
-- 確かか」であって、車がそこに停まっている証明ではない。
-- ============================================================
BEGIN;

ALTER TABLE public.vehicle_positions
  ADD COLUMN IF NOT EXISTS accuracy_m  numeric,
  ADD COLUMN IF NOT EXISTS detected_by text;

-- 申告は「登録車庫・場所名・座標」のいずれかがあればよい。観測は従来どおり座標必須
ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_coords_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_coords_check CHECK (
    (kind = 'parked' AND (
      place_id IS NOT NULL
      OR char_length(coalesce(place_name, '')) > 0
      OR (lat IS NOT NULL AND lng IS NOT NULL)
    ))
    OR (kind = 'observation' AND lat IS NOT NULL AND lng IS NOT NULL)
  );

ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_accuracy_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_accuracy_check CHECK (
    accuracy_m IS NULL OR (accuracy_m >= 0 AND accuracy_m <= 100000)
  );
ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_detected_by_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_detected_by_check CHECK (
    detected_by IS NULL OR detected_by IN ('session_end', 'stop', 'motion')
  );
-- 取得方法だけあって座標が無い行は根拠にならない
ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_detected_by_coords_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_detected_by_coords_check CHECK (
    detected_by IS NULL OR (lat IS NOT NULL AND lng IS NOT NULL)
  );

COMMENT ON COLUMN public.vehicle_positions.accuracy_m IS
  '端末の水平精度（m）。座標が端末の測位から来た行だけに入る。Webの申告・手動配置・拠点の代表点は NULL';
COMMENT ON COLUMN public.vehicle_positions.detected_by IS
  'session_end=業務終了の操作 / stop=停車の継続 / motion=活動変化。手動の申告は NULL';

-- 地図の最新位置 RPC に測位の列を足す（既存の列・順序は変えない）
DROP FUNCTION IF EXISTS public.map_latest_positions(uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.map_latest_positions(p_org uuid, p_at timestamptz DEFAULT NULL)
RETURNS TABLE (
  vehicle_id uuid,
  at timestamptz,
  lat double precision,
  lng double precision,
  source text,
  recorded_by uuid,
  note text,
  kind text,
  place_id uuid,
  place_name text,
  slot_id uuid,
  accuracy_m numeric,
  detected_by text
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (vp.vehicle_id)
         vp.vehicle_id, vp.at, vp.lat, vp.lng, vp.source, vp.recorded_by, vp.note,
         vp.kind, vp.place_id, vp.place_name, vp.slot_id, vp.accuracy_m, vp.detected_by
  FROM public.vehicle_positions vp
  WHERE vp.org_id = p_org
    AND (p_at IS NULL OR vp.at <= p_at)
  ORDER BY vp.vehicle_id, vp.at DESC, vp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.map_latest_positions(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

COMMIT;
