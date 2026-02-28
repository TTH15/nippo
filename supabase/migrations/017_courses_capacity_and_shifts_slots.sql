-- コースごとの最大人数と、同一コース・同一日に複数ドライバーを割り当てるためのスロット列を追加

-- 各コースに「1日あたり最大何名まで割り当て可能か」を表すカラム
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS max_drivers int NOT NULL DEFAULT 1;

-- shifts にスロット番号を追加（1コース・1日あたり複数行を持てるようにする）
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS slot int NOT NULL DEFAULT 1;

-- 既存の (shift_date, course_id) 一意制約をスロット込みの制約に差し替え
ALTER TABLE shifts
  DROP CONSTRAINT IF EXISTS shifts_shift_date_course_id_key;

ALTER TABLE shifts
  ADD CONSTRAINT shifts_shift_date_course_id_slot_key
    UNIQUE (shift_date, course_id, slot);

CREATE INDEX IF NOT EXISTS idx_shifts_date_course_slot
  ON shifts (shift_date, course_id, slot);

