-- 給与・請求・控除を同じ月次締めへ載せるための基盤。
-- migration適用だけでは既存計算を止めない。API/UI接続後に PREPARED → RECONCILED → CLOSED を運用する。
CREATE TABLE IF NOT EXISTS monthly_closings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month         date NOT NULL CHECK (month = date_trunc('month', month)::date),
  status        text NOT NULL DEFAULT 'PREPARED'
                CHECK (status IN ('PREPARED', 'RECONCILED', 'CLOSED')),
  control_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  prepared_at   timestamptz NOT NULL DEFAULT now(),
  prepared_by   uuid REFERENCES drivers(id) ON DELETE SET NULL,
  reconciled_at timestamptz,
  reconciled_by uuid REFERENCES drivers(id) ON DELETE SET NULL,
  closed_at     timestamptz,
  closed_by     uuid REFERENCES drivers(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, month)
);

CREATE TABLE IF NOT EXISTS monthly_closing_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id        uuid NOT NULL REFERENCES monthly_closings(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_type         text NOT NULL CHECK (item_type IN (
    'COUNTERPARTY_RECEIVABLE', 'DRIVER_PAYABLE', 'DRIVER_DEDUCTION', 'VEHICLE_LEASE', 'ADJUSTMENT'
  )),
  subject_id        uuid,
  label             text NOT NULL,
  calculated_amount bigint NOT NULL DEFAULT 0,
  actual_amount     bigint,
  difference_amount bigint GENERATED ALWAYS AS
    (CASE WHEN actual_amount IS NULL THEN NULL ELSE actual_amount - calculated_amount END) STORED,
  state             text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'MATCHED', 'ADJUSTED')),
  source_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  note              text,
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monthly_closings_org_month ON monthly_closings(org_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_closing_items_closing ON monthly_closing_items(closing_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_monthly_closing_items_org ON monthly_closing_items(org_id, item_type);

COMMENT ON TABLE monthly_closings IS '請求・支払・控除を一括で管理する月次締め。CLOSED後はスナップショットを正本とする';
COMMENT ON TABLE monthly_closing_items IS '月次締めの照合内訳。計算額と実入出金額の差を追跡する';
