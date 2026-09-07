-- ============================================================
-- 日報からの駐車申告（2026-09-07）。設計: docs/design/daily-report-parking-foundation.md
--
-- 位置の正本は引き続き vehicle_positions。「位置の観測」（打刻GPS・手動配置・GPS）と
-- 「停めたという申告」（日報の「車の置き場所」）を kind で区別し、申告は登録車庫・区画・
-- 場所名を持つ。登録車庫の座標はサーバーで解決して lat/lng に写す（登録地点の代表点であり、
-- GPS でその場にいたことの確認ではない）。「別の場所」で座標が無い申告は lat/lng を NULL にできる。
-- 再送で二重登録しないよう client_key を持ち、(org, vehicle, client_key) で upsert する。
-- ============================================================
BEGIN;

ALTER TABLE public.vehicle_positions
  ALTER COLUMN lat DROP NOT NULL,
  ALTER COLUMN lng DROP NOT NULL;

ALTER TABLE public.vehicle_positions
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'observation',
  ADD COLUMN IF NOT EXISTS place_id    uuid REFERENCES public.map_places(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slot_id     uuid REFERENCES public.parking_slots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS place_name  text,
  ADD COLUMN IF NOT EXISTS driver_id   uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_date date,
  ADD COLUMN IF NOT EXISTS client_key  text NOT NULL DEFAULT gen_random_uuid()::text;

ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_source_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_source_check CHECK (source IN ('punch', 'manual', 'gps', 'report'));
ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_kind_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_kind_check CHECK (kind IN ('observation', 'parked'));
-- 観測は座標必須。申告は登録車庫か場所名のどちらかが必須で、座標は任意
ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_coords_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_coords_check CHECK (
    (kind = 'parked' AND (place_id IS NOT NULL OR char_length(coalesce(place_name, '')) > 0))
    OR (kind = 'observation' AND lat IS NOT NULL AND lng IS NOT NULL)
  );
ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_place_name_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_place_name_check CHECK (char_length(coalesce(place_name, '')) <= 80);
ALTER TABLE public.vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_note_check;
ALTER TABLE public.vehicle_positions
  ADD CONSTRAINT vehicle_positions_note_check CHECK (char_length(coalesce(note, '')) <= 200);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_positions_client_key
  ON public.vehicle_positions (org_id, vehicle_id, client_key);

COMMENT ON COLUMN public.vehicle_positions.kind IS 'observation=位置の観測（punch/manual/gps） / parked=停めたという申告（日報）';
COMMENT ON COLUMN public.vehicle_positions.place_id IS '申告した登録車庫（map_places）。廃止後は NULL になるので place_name の写しで読む';
COMMENT ON COLUMN public.vehicle_positions.place_name IS '登録車庫名の保存時点の写し、または「別の場所」の場所名';
COMMENT ON COLUMN public.vehicle_positions.driver_id IS '申告の対象ドライバー（recorded_by が代理入力者のとき区別する）';
COMMENT ON COLUMN public.vehicle_positions.client_key IS '再送の識別。同じ送信を二重登録しない';

-- 駐車候補に出す拠点かどうか（アイコンだけで用途を判定しない）
ALTER TABLE public.map_places
  ADD COLUMN IF NOT EXISTS allow_parking boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.map_places.allow_parking IS '日報の「車の置き場所」の候補に出すか';

-- 地図の最新位置 RPC に申告の列を足す（アプリ側は列が無い旧環境にも耐える）
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
  slot_id uuid
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (vp.vehicle_id)
         vp.vehicle_id, vp.at, vp.lat, vp.lng, vp.source, vp.recorded_by, vp.note,
         vp.kind, vp.place_id, vp.place_name, vp.slot_id
  FROM public.vehicle_positions vp
  WHERE vp.org_id = p_org
    AND (p_at IS NULL OR vp.at <= p_at)
  ORDER BY vp.vehicle_id, vp.at DESC, vp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.map_latest_positions(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

COMMIT;
