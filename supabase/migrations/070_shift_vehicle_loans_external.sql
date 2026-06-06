-- ============================================================
-- シフトの車両運用拡張。
--   vehicle_loans: 車両の「日毎の貸出中」。その日付はシフトに紐付け不可にする。
--   shifts.uses_external_vehicle: そのシフトで「他社の車両を利用」フラグ。
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_loans (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid        NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  loan_date  date        NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, loan_date)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_loans_date ON vehicle_loans (loan_date);

COMMENT ON TABLE vehicle_loans IS '車両の日毎の貸出中（その日はシフトに紐付け不可）';

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS uses_external_vehicle boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN shifts.uses_external_vehicle IS 'そのシフトで他社の車両を利用する（自社フリート車両の代わり）';
