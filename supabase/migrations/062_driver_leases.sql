-- ドライバーごとのリース設定（専用概念）。
-- 従来は「リース有り/無し」を別コース化し course_unit_rates.payout_per_unit を
-- 下げて吸収していたが、コースは正準単価1本に固定し、リースはドライバー単位の
-- 控除へ分離する。月額(MONTHLY)＝毎月一定額をフラット控除 / 日割り(DAILY)＝
-- 日額×稼働日数を控除。リース控除は日当(日次報酬)へ反映しドライバーにも表示する。
-- ※ vehicles.lease_cost（会社の回収シミュレーション）とは別概念。
CREATE TABLE IF NOT EXISTS driver_leases (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  mode        text        NOT NULL CHECK (mode IN ('MONTHLY','DAILY')),
  amount      int         NOT NULL CHECK (amount >= 0),  -- MONTHLY=月額(円) / DAILY=日額(1稼働日, 円)
  valid_from  date        NOT NULL DEFAULT date_trunc('month', now())::date,
  valid_to    date,                                       -- 終了月の月末日（NULL=現在も有効）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_leases_driver ON driver_leases (driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_leases_valid_from ON driver_leases (valid_from);
CREATE INDEX IF NOT EXISTS idx_driver_leases_valid_to ON driver_leases (valid_to);

COMMENT ON TABLE driver_leases IS 'ドライバーごとのリース設定（月額フラット or 日割り日額）。報酬の日当から控除する';
COMMENT ON COLUMN driver_leases.amount IS 'MONTHLY=月額(円) / DAILY=日額(1稼働日, 円)。正の値で保存し控除時にマイナス扱い';
