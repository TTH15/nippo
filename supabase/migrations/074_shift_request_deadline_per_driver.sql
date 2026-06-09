-- ============================================================
-- 希望休 提出締切の「ドライバーごと」設定。
--   優先順位（締切の決定）:
--     1. ドライバー個別の期間例外 (driver_id, year, month, half)
--     2. ドライバー個別の既定ルール (driver_id)
--     3. 全体の期間例外 (year, month, half)            … 066
--     4. 全体の既定ルール                              … 066
--   半月の区切り(1〜15 / 16〜末)は全体設定(firstHalfEndDay)で固定。個別では締切日のみ。
-- ============================================================

-- ドライバー個別の既定ルール（毎月適用。行が無ければ全体ルールに従う）。
CREATE TABLE IF NOT EXISTS shift_request_deadline_driver_rules (
  driver_id                         uuid        PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  first_half_deadline_month_offset  int         NOT NULL DEFAULT -1,
  first_half_deadline_day           int         NOT NULL DEFAULT 23,
  second_half_deadline_month_offset int         NOT NULL DEFAULT 0,
  second_half_deadline_day          int         NOT NULL DEFAULT 10,
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

-- ドライバー個別の期間例外（特定の年月×半月だけ締切を上書き）。
CREATE TABLE IF NOT EXISTS shift_request_deadline_driver_overrides (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  target_year   int         NOT NULL,
  target_month  int         NOT NULL,  -- 1-12
  half          text        NOT NULL CHECK (half IN ('FIRST', 'SECOND')),
  deadline_date date        NOT NULL,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, target_year, target_month, half)
);

CREATE INDEX IF NOT EXISTS idx_shift_deadline_driver_overrides_driver
  ON shift_request_deadline_driver_overrides (driver_id);

COMMENT ON TABLE shift_request_deadline_driver_rules IS 'ドライバー個別の希望休締切 既定ルール（毎月適用）。';
COMMENT ON TABLE shift_request_deadline_driver_overrides IS 'ドライバー個別の希望休締切 期間例外（年×月×半月）。';
