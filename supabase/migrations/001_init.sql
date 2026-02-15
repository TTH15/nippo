-- ============================================================
-- 日報集計MVP: Supabase DDL
-- ============================================================

-- Enable pgcrypto for gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- drivers
-- ============================================================
CREATE TABLE drivers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  line_user_id text       UNIQUE,
  role        text        NOT NULL CHECK (role IN ('DRIVER', 'ADMIN')),
  pin_hash    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- daily_reports
-- ============================================================
CREATE TABLE daily_reports (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  report_date           date        NOT NULL,
  takuhaibin_completed  int         NOT NULL DEFAULT 0,
  takuhaibin_returned   int         NOT NULL DEFAULT 0,
  nekopos_completed     int         NOT NULL DEFAULT 0,
  nekopos_returned      int         NOT NULL DEFAULT 0,
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, report_date)
);

CREATE INDEX idx_daily_reports_date ON daily_reports (report_date);
CREATE INDEX idx_daily_reports_driver ON daily_reports (driver_id);

-- ============================================================
-- rate_master
-- ============================================================
CREATE TABLE rate_master (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text        NOT NULL CHECK (kind IN ('TAKUHAIBIN', 'NEKOPOS')),
  rate_per_completed int        NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind)
);

-- Seed default rates
INSERT INTO rate_master (kind, rate_per_completed) VALUES
  ('TAKUHAIBIN', 200),
  ('NEKOPOS', 70);

-- ============================================================
-- payrolls
-- ============================================================
CREATE TABLE payrolls (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  month       char(7)     NOT NULL, -- 'YYYY-MM'
  total_amount int        NOT NULL DEFAULT 0,
  status      text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'PAID')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, month)
);

-- ============================================================
-- Seed: Admin user (PIN: 9999)
-- PIN hash is bcrypt of '9999' — replace in production
-- ============================================================
-- NOTE: Run this after setting up your app. 
-- You can insert drivers via Supabase dashboard or a seed script.
-- Example:
-- INSERT INTO drivers (name, role, pin_hash) VALUES
--   ('管理者', 'ADMIN', '<bcrypt hash of PIN>'),
--   ('田中太郎', 'DRIVER', '<bcrypt hash of PIN>');
