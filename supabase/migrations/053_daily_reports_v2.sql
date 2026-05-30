-- ============================================================
-- 集計刷新 Phase1: 日報（新ヘッダ + 報告値の縦持ち）
-- 旧 daily_reports は温存。新規は daily_reports_v2 + report_entries。
-- ============================================================

-- 日報ヘッダ（旧 daily_reports の付帯カラムも引き継ぐ）
CREATE TABLE IF NOT EXISTS daily_reports_v2 (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  report_date   date        NOT NULL,
  course_id     uuid        REFERENCES courses(id) ON DELETE SET NULL,  -- その日のシフト=コース
  carrier_id    uuid        REFERENCES carriers(id) ON DELETE SET NULL, -- course から導出して冗長保持
  identity_id   uuid        REFERENCES driver_identities(id) ON DELETE SET NULL,
  vehicle_id    uuid        REFERENCES vehicles(id) ON DELETE SET NULL,
  meter_value   int,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  -- 承認ワークフロー（既存踏襲）
  approved_at   timestamptz,
  approved_by   uuid        REFERENCES drivers(id) ON DELETE SET NULL,
  rejected_at   timestamptz,
  rejected_by   uuid        REFERENCES drivers(id) ON DELETE SET NULL,
  -- 移行元（旧 daily_reports.id）。コピー移行の冪等性・追跡に使う。
  legacy_report_id uuid     REFERENCES daily_reports(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_v2_legacy
  ON daily_reports_v2 (legacy_report_id) WHERE legacy_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_reports_v2_date ON daily_reports_v2 (report_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_v2_driver ON daily_reports_v2 (driver_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_v2_carrier ON daily_reports_v2 (carrier_id);

-- ユニーク制約（旧 040 を踏襲: 却下されていない日報にだけ効かせ、却下済みと共存可能に）
-- identity あり: (driver, date, course, identity) で一意
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_v2_driver_date_course_identity_key
  ON daily_reports_v2 (driver_id, report_date, course_id, identity_id)
  WHERE identity_id IS NOT NULL AND rejected_at IS NULL;
-- identity なし: (driver, date, course) で一意
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_v2_driver_date_course_null_identity_key
  ON daily_reports_v2 (driver_id, report_date, course_id)
  WHERE identity_id IS NULL AND rejected_at IS NULL;

-- 報告値の実体（縦持ち / EAV）
CREATE TABLE IF NOT EXISTS report_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid        NOT NULL REFERENCES daily_reports_v2(id) ON DELETE CASCADE,
  unit_id     uuid        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  field_key   text        NOT NULL,
  value_num   numeric,    -- INT / TIME 系
  value_text  text,       -- TEXT / BOOL 系
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, unit_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_report_entries_report ON report_entries (report_id);
CREATE INDEX IF NOT EXISTS idx_report_entries_unit ON report_entries (unit_id);
