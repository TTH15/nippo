-- ============================================================
-- 便（時間帯）はキャリア非依存にする。shift_request_slots から carrier_id を撤去。
--   便名（午前便/午後便/4便…）はキャリアに関係なく共通の時間帯として扱う。
-- ============================================================

DROP INDEX IF EXISTS idx_shift_request_slots_carrier;
-- carrier_id を落とすと、FK と UNIQUE(carrier_id, name) も一緒に外れる。
ALTER TABLE shift_request_slots DROP COLUMN IF EXISTS carrier_id;
-- 便名はグローバルに一意に。
CREATE UNIQUE INDEX IF NOT EXISTS shift_request_slots_name_key ON shift_request_slots (name);
