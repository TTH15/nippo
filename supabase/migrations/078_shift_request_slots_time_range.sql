-- ============================================================
-- 時間帯マスタ（shift_request_slots）に任意の時刻範囲を追加。
--   便名（午前便/1便 等）に加え、時刻（10:00-15:00）でも表せるようにする。
--   表示は「時刻があれば時刻、無ければ便名」。日跨ぎ（22:00-02:00）は今回スコープ外。
--   このマスタは希望休の便とコースの時間帯で共用する（全体の時間帯マスタへ昇格）。
-- ============================================================

ALTER TABLE shift_request_slots
  ADD COLUMN IF NOT EXISTS start_time time NULL,
  ADD COLUMN IF NOT EXISTS end_time   time NULL;

COMMENT ON TABLE  shift_request_slots IS '時間帯マスタ（旧:希望休の便）。希望休とコース時間帯で共用。グローバル・キャリア非依存。';
COMMENT ON COLUMN shift_request_slots.start_time IS '開始時刻。NULL可。表示は時刻優先・無ければ便名。';
COMMENT ON COLUMN shift_request_slots.end_time   IS '終了時刻。NULL可。';
