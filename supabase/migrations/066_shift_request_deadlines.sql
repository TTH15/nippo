-- ============================================================
-- 希望休(shift_requests)の提出締切ルール。
--   既定: 対象月Mの前半(1-15) → 前月(M-1)の23日まで /
--         後半(16-末)         → 当月(M)の10日まで。
--   締切を過ぎた半月はドライバー側で編集不可(完全ロック)。
--   GW等の特例は overrides で「年×月×半月」ごとに締切日を上書き。
--   全ドライバー共通(office で分けない)。単一行 config 運用。
-- ============================================================

-- 既定ルール(単一行)。半月境界(first_half_end_day)は v1 では 15 固定運用。
CREATE TABLE IF NOT EXISTS shift_request_deadline_config (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_half_end_day              int         NOT NULL DEFAULT 15,  -- 前半の最終日(将来拡張余地。v1はUI非公開)
  first_half_deadline_month_offset  int       NOT NULL DEFAULT -1,  -- 前半締切の月オフセット(前月=-1)
  first_half_deadline_day         int         NOT NULL DEFAULT 23,  -- 前半締切の日
  second_half_deadline_month_offset int       NOT NULL DEFAULT 0,   -- 後半締切の月オフセット(当月=0)
  second_half_deadline_day        int         NOT NULL DEFAULT 10,  -- 後半締切の日
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- 期間ごとの締切例外。(target_year, target_month, half) で一意。
CREATE TABLE IF NOT EXISTS shift_request_deadline_overrides (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_year   int         NOT NULL,
  target_month  int         NOT NULL,  -- 1-12
  half          text        NOT NULL CHECK (half IN ('FIRST', 'SECOND')),
  deadline_date date        NOT NULL,  -- この日まで入力可(inclusive)
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_year, target_month, half)
);

CREATE INDEX IF NOT EXISTS idx_shift_deadline_overrides_period
  ON shift_request_deadline_overrides (target_year, target_month);
