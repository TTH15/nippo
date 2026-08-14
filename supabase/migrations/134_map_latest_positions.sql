-- ============================================================
-- 地図の車両一覧を DB 側で「車両ごとの最新1行」に絞る関数（DISTINCT ON）。
--
-- 従来はアプリ側が位置2000行+セッション1000行の固定 limit スキャンを
-- 60秒ごとに転送して JS で先頭だけ採用しており、行数が増えると
-- 「limit の外に落ちた古い車両が地図から黙って消える」バグでもあった
-- （2026-08 通信監査）。as-of（履歴スクラブ）も同じ関数で対応する。
--
-- ★アプリ側 /api/admin/map/vehicles は RPC 優先+未適用環境では従来スキャンへ
--   フォールバックする（返す列は route の select と揃えること）。
-- ============================================================

CREATE OR REPLACE FUNCTION map_latest_positions(p_org uuid, p_at timestamptz DEFAULT NULL)
RETURNS TABLE (
  vehicle_id uuid,
  at timestamptz,
  lat double precision,
  lng double precision,
  source text,
  recorded_by uuid,
  note text
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (vp.vehicle_id)
         vp.vehicle_id, vp.at, vp.lat, vp.lng, vp.source, vp.recorded_by, vp.note
  FROM vehicle_positions vp
  WHERE vp.org_id = p_org
    AND (p_at IS NULL OR vp.at <= p_at)
  ORDER BY vp.vehicle_id, vp.at DESC;
$$;

COMMENT ON FUNCTION map_latest_positions(uuid, timestamptz) IS
  '車両ごとの最新位置（as-of 対応）。地図の60秒ポーリング用';

CREATE OR REPLACE FUNCTION map_latest_sessions(p_org uuid, p_at timestamptz DEFAULT NULL)
RETURNS TABLE (
  vehicle_id uuid,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  recorded_by uuid,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (vs.vehicle_id)
         vs.vehicle_id, vs.status, vs.started_at, vs.ended_at, vs.recorded_by,
         vs.start_lat, vs.start_lng, vs.end_lat, vs.end_lng
  FROM vehicle_sessions vs
  WHERE vs.org_id = p_org
    AND (p_at IS NULL OR vs.started_at <= p_at)
  ORDER BY vs.vehicle_id, vs.started_at DESC NULLS LAST;
$$;

COMMENT ON FUNCTION map_latest_sessions(uuid, timestamptz) IS
  '車両ごとの最新セッション（as-of 対応）。地図の稼働中判定用';
