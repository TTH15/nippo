-- 複数サイクルを同日稼働した場合の「全日日当」。
-- NULL は便別日当の合計を使用する意味で、売上・支払を独立して上書きできる。
CREATE TABLE IF NOT EXISTS course_fixed_rate_bundles (
  course_id uuid PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  required_cycle_nos int[] NOT NULL DEFAULT '{}',
  fixed_revenue int,
  fixed_payout int,
  revenue_contract_amount int,
  payout_contract_amount int,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fixed_revenue IS NULL OR fixed_revenue >= 0),
  CHECK (fixed_payout IS NULL OR fixed_payout >= 0)
);

COMMENT ON TABLE course_fixed_rate_bundles IS
  '全サイクル稼働時の固定売上・支払。売上はコース/日、支払はドライバー/コース/日で成立判定する';
