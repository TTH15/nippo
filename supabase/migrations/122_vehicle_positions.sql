-- ============================================================
-- 配車作戦盤 Stage 0.5: 位置を「出どころ付きの時系列」で持つ
--   設計: docs/design/map-board.md
--
-- これまで地図の位置は vehicle_sessions の打刻GPSからその場で導出していた。
-- 位置そのものを保存しないため「何月何日◯時の位置」も「手でここに置く」もできない。
--
-- 方針（ユーザー承認 2026-08-06・decisions-pending A1/A2）:
--   ・上書きではなく **追記**。置き直した経緯そのものが履歴＝資産になる
--   ・source で出どころを必ず区別する（punch / manual / gps）
--   ・**manual は集計（請求・稼働・走行距離）に使わない**。共有のための付箋であって実績ではない
--   ・GPS が入ったら source='gps' を流し込むだけ。UI もクエリも変えない
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_positions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL,
  vehicle_id   uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  at           timestamptz NOT NULL,              -- 「いつの位置か」。記録した時刻ではない
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  heading      real,                              -- 進行方向（GPS のみ・任意）
  accuracy_m   real,                              -- 精度メートル（GPS のみ・任意）
  source       text        NOT NULL CHECK (source IN ('punch', 'manual', 'gps')),
  recorded_by  uuid        REFERENCES drivers(id) ON DELETE SET NULL,  -- manual では必須
  note         text,                              -- 「センター戻り」等の一言
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vehicle_positions IS
  '車両位置の時系列。現在地=最新行、履歴=at<=T の最新行（as-of）。source で出どころを区別し、manual は集計に使わない';
COMMENT ON COLUMN vehicle_positions.at IS '「いつの位置か」。打刻時刻・GPS取得時刻・手動配置時刻';
COMMENT ON COLUMN vehicle_positions.source IS 'punch=打刻GPS / manual=運営が地図上で配置 / gps=バックグラウンド位置';

-- 現在地・履歴スクラブの両方がこのインデックスで引ける
CREATE INDEX IF NOT EXISTS idx_vehicle_positions_vehicle_at
  ON vehicle_positions (org_id, vehicle_id, at DESC);
-- 「その日の全車両ぶんを1回で取る」（履歴スクラブ）用
CREATE INDEX IF NOT EXISTS idx_vehicle_positions_org_at
  ON vehicle_positions (org_id, at DESC);

-- ------------------------------------------------------------
-- 既存の打刻GPSを punch として取り込む（冪等）。
-- 出勤地点と退勤地点をそれぞれ1行にする。座標が無いセッションは対象外。
-- ------------------------------------------------------------
INSERT INTO vehicle_positions (org_id, vehicle_id, at, lat, lng, source, recorded_by)
SELECT s.org_id, s.vehicle_id, s.started_at, s.start_lat, s.start_lng, 'punch', s.recorded_by
FROM vehicle_sessions s
WHERE s.start_lat IS NOT NULL
  AND s.start_lng IS NOT NULL
  AND s.started_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_positions p
    WHERE p.vehicle_id = s.vehicle_id AND p.at = s.started_at AND p.source = 'punch'
  );

INSERT INTO vehicle_positions (org_id, vehicle_id, at, lat, lng, source, recorded_by)
SELECT s.org_id, s.vehicle_id, s.ended_at, s.end_lat, s.end_lng, 'punch', s.recorded_by
FROM vehicle_sessions s
WHERE s.end_lat IS NOT NULL
  AND s.end_lng IS NOT NULL
  AND s.ended_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_positions p
    WHERE p.vehicle_id = s.vehicle_id AND p.at = s.ended_at AND p.source = 'punch'
  );
