-- ドライバーが自分で入力する自由経費（ガソリン代など）。管理者からは参照・編集不可。報酬画面の計算用のみ。
CREATE TABLE IF NOT EXISTS driver_optional_expenses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  month      text        NOT NULL,   -- YYYY-MM
  name       text        NOT NULL,   -- 経費名（例: ガソリン代）
  amount     int         NOT NULL,   -- 金額（円）。正の値で保存し、控除として扱う
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_optional_expenses_driver_month ON driver_optional_expenses (driver_id, month);

COMMENT ON TABLE driver_optional_expenses IS 'ドライバーが任意で入力する経費（ガソリン代など）。管理者は参照・編集不可。報酬の暫定計算用';
