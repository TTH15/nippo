-- ============================================================
-- 単発案件（spot_jobs）— 「仕事」統合モデル Phase 1
-- 案件（継続=courses / 単発=spot_jobs）×日付×人=勤務、という整理の単発側。
--   spot_jobs        : 単発案件（1案件=1日。複数日はコピーで増やす）
--   spot_job_members : 参加者（登録メンバー or 名前だけの同行者）
--   drivers.member_kind : ログインしない「ゲスト」membership の区別
-- shifts / courses には手を入れない（統合は読みモデルで行う）。
-- 金額は参考値のみ（確定・締めには乗せない = roadmap H）。
-- 追加のみ・冪等（IF NOT EXISTS）。RLS不使用＝アプリ層 org_id スコープ。
--   設計: docs/design/work-model.md §3,§7
-- ============================================================

-- ---- 単発案件 ----------------------------------------------------
CREATE TABLE IF NOT EXISTS spot_jobs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES organizations(id),
  title          text        NOT NULL,                 -- 案件名（自由入力）
  job_date       date        NOT NULL,                 -- 1案件=1日
  meeting_place  text,                                 -- courses/shifts と同じ語彙（自由入力）
  meeting_time   time,
  end_time       time,
  client_name    text,                                 -- 依頼元メモ（取引先マスタとは結ばない）
  billing_amount integer,                              -- 請求の参考値（円）。確定ではない
  note           text,
  status         text        NOT NULL DEFAULT 'planned'
                             CHECK (status IN ('planned', 'done', 'cancelled')),
  created_by     uuid        REFERENCES drivers(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spot_jobs_org_date ON spot_jobs (org_id, job_date);

COMMENT ON TABLE  spot_jobs IS '単発案件（1案件=1日）。コース・シフトとは独立。金額は参考値のみ（work-model §3,§7）';
COMMENT ON COLUMN spot_jobs.billing_amount IS '請求の参考値（円）。締め・請求書には乗せない（roadmap H）';

-- ---- 参加者（勤務） ----------------------------------------------
CREATE TABLE IF NOT EXISTS spot_job_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid        NOT NULL REFERENCES spot_jobs(id) ON DELETE CASCADE,
  driver_id    uuid        REFERENCES drivers(id) ON DELETE SET NULL,  -- 登録メンバー（正規/ゲスト）
  display_name text,                                                   -- 名前だけの同行者
  pay_amount   integer,                                                -- 日当の参考値（円）
  vehicle_id   uuid        REFERENCES vehicles(id) ON DELETE SET NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (driver_id IS NOT NULL OR display_name IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_spot_job_members_driver
  ON spot_job_members (job_id, driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spot_job_members_driver ON spot_job_members (driver_id);

COMMENT ON TABLE  spot_job_members IS '単発案件の参加者。driver_id あり=登録メンバー / display_name のみ=その日だけの人（後日 driver_id を埋めて昇格）';
COMMENT ON COLUMN spot_job_members.pay_amount IS '日当の参考値（円）。給与集計には乗せない（roadmap H）';

-- ---- ゲスト membership の区別 ------------------------------------
-- ゲスト = member_kind='guest', identity_id NULL, works_as_driver=false, status='active'。
-- シフト表の抽出（works_as_driver=true）には出ず、単発案件のピッカーにだけ出す。
-- 管理スタッフ（works_as_driver=false）と区別するため boolean ではなく kind 列。
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS member_kind text NOT NULL DEFAULT 'regular';

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_member_kind_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_member_kind_check
  CHECK (member_kind IN ('regular', 'guest'));

COMMENT ON COLUMN drivers.member_kind IS 'regular=通常 / guest=ログインしないゲスト membership（単発案件用。work-model §3）';
