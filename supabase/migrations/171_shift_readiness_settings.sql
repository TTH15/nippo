-- ============================================================
-- 未解決一覧の「いつまでに直すか」を会社ごとに決める（2026-09-18）。
-- 設計: docs/design/operational-risk-detection-2026-09.md O-1
--
-- これまで解消期限はコードの固定値（人数・原本は3日前 / 本人確認は2日前 / 配車は前日）だった。
-- 実際に間に合う日数は会社・荷主で違うので、既定値はそのままに設定で変えられるようにする。
--
-- 種類ごとに9つの数字を設定させない。手を打つ相手が同じものを3つにまとめる。
--   staffing     … 人が足りない / 休みの日に配置 / 人数未確定 / 原本と不一致（人の手配・原本の直し）
--   confirmation … 本人未確認 / 対応不可 / 要再確認（本人への連絡）
--   dispatch     … 配車未完了（車の割当）
-- 「必要人数の基準が未設定」は特定の日の話ではないので期限を持たない。
--
-- horizon_days は「何日先まで一覧に出すか」。期限より短いと、期限が来る前に
-- 一覧へ現れない日ができてしまうので、期限の最大値以上であることを制約で担保する。
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.shift_readiness_settings (
  org_id             uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 対象日の何日前までに直すか
  staffing_due_days     int NOT NULL DEFAULT 3,
  confirmation_due_days int NOT NULL DEFAULT 2,
  dispatch_due_days     int NOT NULL DEFAULT 1,
  -- 何日先まで一覧に出すか
  horizon_days          int NOT NULL DEFAULT 14,
  updated_by         uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_readiness_settings_due_days_check CHECK (
    staffing_due_days     BETWEEN 0 AND 30
    AND confirmation_due_days BETWEEN 0 AND 30
    AND dispatch_due_days     BETWEEN 0 AND 30
  ),
  CONSTRAINT shift_readiness_settings_horizon_check CHECK (horizon_days BETWEEN 1 AND 60),
  -- 期限より先まで見ていないと、期限が来る前に一覧へ出ない日ができる
  CONSTRAINT shift_readiness_settings_horizon_covers_due_check CHECK (
    horizon_days >= GREATEST(staffing_due_days, confirmation_due_days, dispatch_due_days)
  )
);

COMMENT ON TABLE public.shift_readiness_settings IS
  '未解決一覧の解消期限と先読み日数。行が無い会社はコード側の既定値（3/2/1日前・14日先）で動く';
COMMENT ON COLUMN public.shift_readiness_settings.staffing_due_days IS
  '人が足りない・休みの日に配置・人数未確定・原本と不一致を、対象日の何日前までに直すか';
COMMENT ON COLUMN public.shift_readiness_settings.confirmation_due_days IS
  '本人未確認・対応不可・要再確認を、対象日の何日前までに解消するか';
COMMENT ON COLUMN public.shift_readiness_settings.dispatch_due_days IS
  '配車未完了を、対象日の何日前までに解消するか';
COMMENT ON COLUMN public.shift_readiness_settings.horizon_days IS
  '未解決一覧に出す先読みの日数。解消期限の最大値以上であること';

REVOKE ALL ON public.shift_readiness_settings FROM PUBLIC, anon, authenticated;

COMMIT;
