-- ============================================================
-- オイル交換実施報告（ユーザー報告 -> 管理承認）
-- ============================================================
CREATE TABLE IF NOT EXISTS oil_change_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  report_time time NOT NULL,
  occurred_at timestamptz NOT NULL,
  location text NOT NULL,
  odometer_km integer NOT NULL CHECK (odometer_km >= 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES drivers(id),
  rejected_at timestamptz,
  rejected_by uuid REFERENCES drivers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oil_change_reports_driver_id_idx
  ON oil_change_reports(driver_id);

CREATE INDEX IF NOT EXISTS oil_change_reports_submitted_at_idx
  ON oil_change_reports(submitted_at DESC);
