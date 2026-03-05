-- 管理者が登録する臨時経費（月単位・ドライバーごと）。報酬計算で控除に含める。
CREATE TABLE IF NOT EXISTS driver_ad_hoc_expenses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  month      text        NOT NULL,   -- YYYY-MM
  name       text        NOT NULL,   -- 経費名（例: 臨時研修費）
  amount     int         NOT NULL,   -- 金額（円）。正の値で保存し、控除として扱う
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_ad_hoc_expenses_driver_month ON driver_ad_hoc_expenses (driver_id, month);

COMMENT ON TABLE driver_ad_hoc_expenses IS '管理者が登録する臨時経費（月単位）。報酬の暫定計算で控除に含める';
