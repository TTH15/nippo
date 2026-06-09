-- ============================================================
-- 希望休の「便（時間帯）」対応。
--   便マスタ（キャリア別・運営設定）を作り、ドライバーごとに「使う便」を割り当てる。
--   希望休は (driver, date, slot) 単位。slot=NULL は全休（その日まるごと）。
--   未割り当てドライバー＝便なし＝全休のみ（従来通り）。
-- ============================================================

-- 便マスタ（キャリア別）。
CREATE TABLE IF NOT EXISTS shift_request_slots (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid        NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  name       text        NOT NULL,           -- 午前便 / 午後便 / 4便 等
  sort_order int         NOT NULL DEFAULT 0,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, name)
);
CREATE INDEX IF NOT EXISTS idx_shift_request_slots_carrier ON shift_request_slots (carrier_id);

-- 便を使うドライバー（便ごとに割り当て）。未登録のドライバーは全休のみ。
CREATE TABLE IF NOT EXISTS driver_request_slots (
  driver_id  uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  slot_id    uuid        NOT NULL REFERENCES shift_request_slots(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_driver_request_slots_driver ON driver_request_slots (driver_id);

-- shift_requests に便を追加。NULL=全休。
ALTER TABLE shift_requests
  ADD COLUMN IF NOT EXISTS slot_id uuid REFERENCES shift_request_slots(id) ON DELETE CASCADE;

-- 旧 UNIQUE(driver_id, request_date) を撤去し、便を考慮した部分ユニークへ。
--   全休: 1日1行 / 便: 便ごと1行。
ALTER TABLE shift_requests DROP CONSTRAINT IF EXISTS shift_requests_driver_id_request_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS shift_requests_driver_date_allday_key
  ON shift_requests (driver_id, request_date)
  WHERE slot_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shift_requests_driver_date_slot_key
  ON shift_requests (driver_id, request_date, slot_id)
  WHERE slot_id IS NOT NULL;

COMMENT ON TABLE shift_request_slots IS '希望休の便（時間帯）マスタ。キャリア別・運営設定。';
COMMENT ON TABLE driver_request_slots IS '便を使うドライバーの割り当て。未登録＝全休のみ。';
COMMENT ON COLUMN shift_requests.slot_id IS '便。NULL=全休（その日まるごと）。';
