-- 故障・整備待ちなど、廃車とは異なる一時的な利用停止状態を車両マスターに持たせる。
-- 既存行は DEFAULT false により利用可能のまま。過去の日報・シフト・個数は更新しない。
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS is_unavailable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unavailable_reason text;

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_unavailable_reason_length_check;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_unavailable_reason_length_check
  CHECK (unavailable_reason IS NULL OR char_length(unavailable_reason) <= 120);

COMMENT ON COLUMN vehicles.is_unavailable IS '故障・整備待ち等による一時使用不可フラグ（廃車とは別）';
COMMENT ON COLUMN vehicles.unavailable_reason IS '一時使用不可の理由（最大120文字）';
