-- ============================================================
-- 追加マイグレーション: シフト・車両管理
-- ============================================================

-- ============================================================
-- courses (配送コース)
-- ============================================================
CREATE TABLE courses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  color       text        NOT NULL DEFAULT '#3b82f6', -- 表示色
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- シードデータ
INSERT INTO courses (name, color, sort_order) VALUES
  ('ヤマトA', '#3b82f6', 1),
  ('ヤマトB', '#22c55e', 2),
  ('ヤマトC', '#f59e0b', 3),
  ('Amazonミッドナイト', '#8b5cf6', 4);

-- ============================================================
-- driver_courses (ドライバーとコースの紐付け)
-- ============================================================
CREATE TABLE driver_courses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  course_id   uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, course_id)
);

CREATE INDEX idx_driver_courses_driver ON driver_courses (driver_id);
CREATE INDEX idx_driver_courses_course ON driver_courses (course_id);

-- ============================================================
-- shifts (シフト: 日付×コース→ドライバー)
-- ============================================================
CREATE TABLE shifts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_date  date        NOT NULL,
  course_id   uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  driver_id   uuid        REFERENCES drivers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_date, course_id)
);

CREATE INDEX idx_shifts_date ON shifts (shift_date);
CREATE INDEX idx_shifts_driver ON shifts (driver_id);

-- ============================================================
-- shift_requests (ドライバーの希望休)
-- ============================================================
CREATE TABLE shift_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  request_date date       NOT NULL,
  request_type text       NOT NULL DEFAULT 'OFF' CHECK (request_type IN ('OFF')), -- 将来拡張用
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, request_date)
);

CREATE INDEX idx_shift_requests_driver ON shift_requests (driver_id);
CREATE INDEX idx_shift_requests_date ON shift_requests (request_date);

-- ============================================================
-- vehicles (車両管理)
-- ============================================================
CREATE TABLE vehicles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL, -- 車両名/ナンバー
  current_mileage     int         NOT NULL DEFAULT 0, -- 現在メーター(km)
  last_oil_change_mileage int     NOT NULL DEFAULT 0, -- 前回オイル交換時のメーター
  oil_change_interval int         NOT NULL DEFAULT 5000, -- オイル交換間隔(km)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- サンプルデータ
INSERT INTO vehicles (name, current_mileage, last_oil_change_mileage, oil_change_interval) VALUES
  ('軽バン 1号', 45000, 43000, 5000),
  ('軽バン 2号', 32000, 30000, 5000),
  ('軽バン 3号', 58000, 55000, 5000);
