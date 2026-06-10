-- ============================================================
-- コースに「時間帯」を紐づける（コース＝時間帯）。
--   courses.slot_id（時間帯マスタ参照、NULL=終日）。
--   「1日2シフト」は時間帯の異なる2コースの割当として表現する（既存の複数コース割当を活用）。
--   時間帯マスタを消してもコースは残す（ON DELETE SET NULL）。
-- ============================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS slot_id uuid NULL
    REFERENCES shift_request_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_slot ON courses (slot_id);

COMMENT ON COLUMN courses.slot_id IS 'コースの時間帯（shift_request_slots参照）。NULL=終日。';
