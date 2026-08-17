-- ============================================================
-- コースの「便（cycle）」— Phase 1（2026-08-17）
--   設計の正本: docs/design/course-cycle.md
--
-- 「豊中Amazon 1便」「豊中Amazon 2便」のように、同じ現場の便違いを
-- 別コースとして作っている状態を、コースの構造として表現できるようにする。
--
-- ★このマイグレーションは追加のみで、既存の挙動を一切変えない:
--   - courses.uses_cycles の既定は false = 便を使わない（今の全コース）
--   - 参照側の cycle_no は既定 0 = 便の区別なし。既存行は全て 0 で埋まる
--   - 一意制約に cycle_no を足すが、全行 0 なので実質的な制約は不変
--   便を作り始めるまで、画面もデータも今日と同じように動く。
--
-- 用語（docs/design/course-cycle.md §1）:
--   便       = course_cycles（1便・2便）        ← このマイグレーションで新設
--   時間帯   = shift_request_slots（午前・午後） ← 既存。「便」とは呼ばない
--   枠       = shifts.slot（同日同コースの何人目か） ← 既存。便ではない
--   勤務区分 = driver_identities.slot            ← 既存。人の別人格
-- ============================================================

-- ------------------------------------------------------------
-- 1) コースの運用単位: サイクルを使うか
--    「使わない」を NULL や 0 件で暗黙表現せず、設定として明示する。
--    false = コース自身が1日の稼働時間を持つ（今と同じ）
--    true  = 時間は course_cycles が持つ
-- ------------------------------------------------------------
ALTER TABLE courses ADD COLUMN IF NOT EXISTS uses_cycles boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN courses.uses_cycles IS
  'サイクル(便)を使うか。false=コース自身が時間を持つ／true=course_cycles が時間を持つ';

-- ------------------------------------------------------------
-- 2) 便マスタ
--    cycle_no は 1 始まり。0 は「便の区別なし」の予約値なので使わない。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_cycles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  cycle_no      int         NOT NULL CHECK (cycle_no >= 1),
  -- 表示名。NULL なら「N便」と表示する（"C1" 等を入れてもよい）
  label         text,
  -- 便ごとの時間。uses_cycles = true のときはこちらが主
  meeting_place text,
  meeting_time  time,        -- 集合
  arrival_time  time,        -- 開始
  end_time      time,        -- 終了目安
  -- NULL ならコース既定（courses.max_drivers）
  max_drivers   int,
  sort_order    int         NOT NULL DEFAULT 0,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, cycle_no)
);

CREATE INDEX IF NOT EXISTS idx_course_cycles_course ON course_cycles (course_id, sort_order);

COMMENT ON TABLE course_cycles IS
  'コースの便(1便/2便)。時間帯マスタ(shift_request_slots)とは別概念。docs/design/course-cycle.md';

-- ------------------------------------------------------------
-- 3) 参照側に cycle_no を足す（既定 0 = 便の区別なし／全便）
--
--    ★NULL ではなく 0 を使う理由: Postgres の UNIQUE は NULL 同士を別物として
--      扱うため、NULL が混ざると重複を止められない（NULLS NOT DISTINCT は PG15+）。
--      0 なら既存行が自動で埋まり、バックフィルも不要。
-- ------------------------------------------------------------
ALTER TABLE shifts             ADD COLUMN IF NOT EXISTS cycle_no int NOT NULL DEFAULT 0;
ALTER TABLE daily_reports_v2   ADD COLUMN IF NOT EXISTS cycle_no int NOT NULL DEFAULT 0;
ALTER TABLE course_unit_rates  ADD COLUMN IF NOT EXISTS cycle_no int NOT NULL DEFAULT 0;
ALTER TABLE course_fixed_rates ADD COLUMN IF NOT EXISTS cycle_no int NOT NULL DEFAULT 0;
ALTER TABLE driver_courses     ADD COLUMN IF NOT EXISTS cycle_no int NOT NULL DEFAULT 0;
ALTER TABLE shift_change_logs  ADD COLUMN IF NOT EXISTS cycle_no int NOT NULL DEFAULT 0;

COMMENT ON COLUMN shifts.cycle_no IS '便(course_cycles.cycle_no)。0=便の区別なし';
COMMENT ON COLUMN daily_reports_v2.cycle_no IS '便。0=便の区別なし。同コースの1便/2便を別日報にするための一意キーの一部';
COMMENT ON COLUMN course_unit_rates.cycle_no IS '便。0=全便共通。解決順は「完全一致 → 0」';
COMMENT ON COLUMN course_fixed_rates.cycle_no IS '便。0=全便共通。解決順は「完全一致 → 0」';
COMMENT ON COLUMN driver_courses.cycle_no IS '便。0=全便を担当可';

-- ------------------------------------------------------------
-- 4) 一意制約の張り替え
--    既存行は全て cycle_no = 0 なので、制約の実効は変わらない。
-- ------------------------------------------------------------

-- 4-1) shifts: 「日 × コース × 便 × 枠」で一意
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_shift_date_course_id_slot_key;
DROP INDEX IF EXISTS idx_shifts_date_course_slot;
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_date_course_cycle_slot_key;
ALTER TABLE shifts
  ADD CONSTRAINT shifts_date_course_cycle_slot_key
  UNIQUE (shift_date, course_id, cycle_no, slot);

-- 4-2) daily_reports_v2: 却下されていない日報のみ一意（旧 057 を踏襲して便を追加）
DROP INDEX IF EXISTS daily_reports_v2_driver_date_course_identity_key;
DROP INDEX IF EXISTS daily_reports_v2_driver_date_course_null_identity_key;
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_v2_driver_date_course_cycle_identity_key
  ON daily_reports_v2 (driver_id, report_date, course_id, cycle_no, identity_id)
  WHERE identity_id IS NOT NULL AND rejected_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_v2_driver_date_course_cycle_key
  ON daily_reports_v2 (driver_id, report_date, course_id, cycle_no)
  WHERE identity_id IS NULL AND rejected_at IS NULL;

-- 4-3) course_unit_rates: コース × 便 × unit
ALTER TABLE course_unit_rates DROP CONSTRAINT IF EXISTS course_unit_rates_course_id_unit_id_key;
ALTER TABLE course_unit_rates DROP CONSTRAINT IF EXISTS course_unit_rates_course_cycle_unit_key;
ALTER TABLE course_unit_rates
  ADD CONSTRAINT course_unit_rates_course_cycle_unit_key
  UNIQUE (course_id, cycle_no, unit_id);

-- 4-4) course_fixed_rates: PK を (course_id) → (course_id, cycle_no)
--      ★破壊的。ON CONFLICT (course_id) の書き込みは全て張り替えが必要。
ALTER TABLE course_fixed_rates DROP CONSTRAINT IF EXISTS course_fixed_rates_pkey;
ALTER TABLE course_fixed_rates
  ADD CONSTRAINT course_fixed_rates_pkey PRIMARY KEY (course_id, cycle_no);

-- 4-5) driver_courses: 勤務区分 × コース × 便
ALTER TABLE driver_courses DROP CONSTRAINT IF EXISTS driver_courses_identity_course;
ALTER TABLE driver_courses DROP CONSTRAINT IF EXISTS driver_courses_identity_course_cycle;
ALTER TABLE driver_courses
  ADD CONSTRAINT driver_courses_identity_course_cycle
  UNIQUE (driver_identity_id, course_id, cycle_no);

-- ------------------------------------------------------------
-- 5) 便を引きやすくする索引
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shifts_course_cycle ON shifts (course_id, cycle_no);
