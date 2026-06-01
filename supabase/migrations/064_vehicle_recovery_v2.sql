-- 初期費用回収の作り直し（自動カレンダー月＋手動行＋日額リース自動計上）。
-- ⚠️ 既存データ非破壊: 旧 vehicle_recovery_collected（チェックボックスの月マーク）は
--    一切変更・削除しない。既存の回収済み額は recovery_carryover（繰越）へ移行して引き継ぐ。

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS recovery_start_month date;                  -- 回収開始月(YYYY-MM-01)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS recovery_carryover  int NOT NULL DEFAULT 0;  -- 繰越(移行済み)回収額(円)

-- 既存の手動マーク回収額を「繰越」として保存（= 旧画面の recoveredAmount: collected月数 ×(lease_cost−保険料)）。
-- DEFAULT_LEASE_COST(コード)=35000 と整合。
UPDATE vehicles v
SET recovery_carryover = sub.cnt * GREATEST(COALESCE(v.lease_cost, 35000) - COALESCE(v.monthly_insurance, 0), 0)
FROM (
  SELECT vehicle_id, COUNT(*) AS cnt
  FROM vehicle_recovery_collected
  GROUP BY vehicle_id
) sub
WHERE sub.vehicle_id = v.id;

-- 自動カレンダー月の起点は当月から（過去は繰越に集約＝二重計上回避）。後で各車両で調整可。
UPDATE vehicles SET recovery_start_month = date_trunc('month', now())::date WHERE recovery_start_month IS NULL;

-- 月に紐づく手動の回収行（自動カレンダー月に加算）。
CREATE TABLE IF NOT EXISTS vehicle_recovery_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ym          date        NOT NULL,                 -- 対象月(YYYY-MM-01)
  lease       int         NOT NULL DEFAULT 0,
  insurance   int         NOT NULL DEFAULT 0,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_recovery_entries_vehicle ON vehicle_recovery_entries (vehicle_id);

COMMENT ON COLUMN vehicles.recovery_start_month IS '初期費用回収の自動カレンダー月の起点(YYYY-MM-01)';
COMMENT ON COLUMN vehicles.recovery_carryover IS '繰越(移行済み)回収額。旧vehicle_recovery_collectedからの移行＋手修正可';
COMMENT ON TABLE vehicle_recovery_entries IS '初期費用回収に月単位で加算する手動行';
