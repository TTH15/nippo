-- ドライバーごとの固定経費（オイル交換代・リース代・事務手数料など）
CREATE TABLE IF NOT EXISTS driver_fixed_expenses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  name         text        NOT NULL,    -- 経費名（例: オイル交換代, リース代）
  amount       int         NOT NULL,    -- 月額（円）。正の値で保存し、控除時にマイナス扱いとする
  cycle        text        NOT NULL DEFAULT 'MONTHLY' CHECK (cycle IN ('MONTHLY')),
  valid_from   date        NOT NULL DEFAULT date_trunc('month', now())::date,
  valid_to     date,                   -- 終了月の月末日（NULL の場合は現在も有効）
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_fixed_expenses_driver ON driver_fixed_expenses (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_fixed_expenses_valid_from ON driver_fixed_expenses (valid_from);
CREATE INDEX IF NOT EXISTS idx_driver_fixed_expenses_valid_to ON driver_fixed_expenses (valid_to);

COMMENT ON TABLE driver_fixed_expenses IS 'ドライバーごとの月額固定経費（リース代・事務手数料など）';
COMMENT ON COLUMN driver_fixed_expenses.amount IS '月額（円）。正の値で保存し、控除時にマイナスとして扱う';

