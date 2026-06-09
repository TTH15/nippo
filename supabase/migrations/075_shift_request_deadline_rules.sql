-- ============================================================
-- 希望休 提出締切の「ルール」化（柔軟な提出期間対応）。
--   074（ドライバー個別テーブル）は廃止し、名前付きルール＋自由な提出期間に置き換える。
--
--   モデル:
--     ルール        = 名前 ＋ 「提出期間」のリスト
--     提出期間(period) = 対象日範囲 [start_day, end_day] ＋ 締切(月オフセット, 日)
--                      例) 月1回: [1,31]→前月23日 / 半月: [1,15]→前月23,[16,31]→当月10
--     期間例外      = ルール×年×月×period で締切日を上書き（GW等）
--     割り当て      = ドライバー→ルール（1人1ルール）。未割り当て＝常に提出可（締切なし）。
--
--   締切の優先順位（割り当て済み）: ルールの期間例外 → ルールの期間締切。
--   未割り当て: 締切なし（常にオープン）。
-- ============================================================

-- 旧・ドライバー個別テーブル（074）を撤去。
DROP TABLE IF EXISTS shift_request_deadline_driver_overrides;
DROP TABLE IF EXISTS shift_request_deadline_driver_rules;

-- ルール（名前付き）。
CREATE TABLE IF NOT EXISTS shift_request_deadline_rules (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  sort_order int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 提出期間（ルールごと、自由に何個でも）。
--   start_day/end_day は 1-31（end_day は月末超過を実行時に当月末へクランプ）。
--   deadline_month_offset: 前月=-1, 当月=0, 翌月=1。deadline_day: 1-28 目安。
CREATE TABLE IF NOT EXISTS shift_request_deadline_rule_periods (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id               uuid        NOT NULL REFERENCES shift_request_deadline_rules(id) ON DELETE CASCADE,
  seq                   int         NOT NULL,           -- 期間の並び順（0..n）
  start_day             int         NOT NULL,
  end_day               int         NOT NULL,
  deadline_month_offset int         NOT NULL DEFAULT -1,
  deadline_day          int         NOT NULL DEFAULT 23,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_shift_deadline_rule_periods_rule
  ON shift_request_deadline_rule_periods (rule_id);

-- ルール固有の期間例外（年×月×period の締切上書き）。
CREATE TABLE IF NOT EXISTS shift_request_deadline_rule_overrides (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid        NOT NULL REFERENCES shift_request_deadline_rules(id) ON DELETE CASCADE,
  target_year   int         NOT NULL,
  target_month  int         NOT NULL,  -- 1-12
  period_seq    int         NOT NULL,  -- 対象の提出期間
  deadline_date date        NOT NULL,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, target_year, target_month, period_seq)
);
CREATE INDEX IF NOT EXISTS idx_shift_deadline_rule_overrides_rule
  ON shift_request_deadline_rule_overrides (rule_id);

-- ドライバー → ルール（1人1ルール）。未割り当て＝常に提出可。
CREATE TABLE IF NOT EXISTS shift_request_deadline_rule_assignments (
  driver_id  uuid        PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  rule_id    uuid        NOT NULL REFERENCES shift_request_deadline_rules(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_deadline_rule_assignments_rule
  ON shift_request_deadline_rule_assignments (rule_id);

COMMENT ON TABLE shift_request_deadline_rules IS '希望休締切の名前付きルール。';
COMMENT ON TABLE shift_request_deadline_rule_periods IS 'ルールの提出期間（日範囲＋締切）。自由な数。';
COMMENT ON TABLE shift_request_deadline_rule_overrides IS 'ルール固有の期間例外（年×月×period）。';
COMMENT ON TABLE shift_request_deadline_rule_assignments IS 'ドライバーを締切ルールに割り当て。未割り当て＝常に提出可。';

-- 既存挙動の保全: ルール未作成なら「標準」(半月2期間)を作り、066の締切日・期間例外を引き継ぎ、
--   現ドライバー全員を割り当てる。再実行安全（ルールがあれば何もしない）。
DO $$
DECLARE
  std_id uuid;
  fh int;
  sh int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shift_request_deadline_rules) THEN
    SELECT first_half_deadline_day, second_half_deadline_day INTO fh, sh
      FROM shift_request_deadline_config LIMIT 1;
    INSERT INTO shift_request_deadline_rules (name, sort_order) VALUES ('標準', 0) RETURNING id INTO std_id;
    INSERT INTO shift_request_deadline_rule_periods (rule_id, seq, start_day, end_day, deadline_month_offset, deadline_day)
      VALUES
        (std_id, 0, 1, 15, -1, COALESCE(fh, 23)),
        (std_id, 1, 16, 31, 0, COALESCE(sh, 10));
    -- 066 の全体期間例外を標準ルールへ複製（FIRST→period 0, SECOND→period 1）。
    INSERT INTO shift_request_deadline_rule_overrides (rule_id, target_year, target_month, period_seq, deadline_date, note)
      SELECT std_id, target_year, target_month, CASE WHEN half = 'FIRST' THEN 0 ELSE 1 END, deadline_date, note
      FROM shift_request_deadline_overrides;
    INSERT INTO shift_request_deadline_rule_assignments (driver_id, rule_id)
      SELECT id, std_id FROM drivers
      ON CONFLICT (driver_id) DO NOTHING;
  END IF;
END $$;
