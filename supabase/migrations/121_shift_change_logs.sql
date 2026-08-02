-- ============================================================
-- 配車・シフト割当の変更ログ（2026-08-03）。
-- 「いつ・誰が・どの割当を・どう変えたか」を1変更=1行で残す軽量な追記専用テーブル。
-- 目的: 監査というより将来の AI（配車提案・制約学習）の学習/文脈データ。
-- 「誰がどの車を使ったか」の実績は vehicle_sessions（出退勤）が一次ログのため対象外。
-- 書き込みはアプリ側でベストエフォート（失敗しても本処理は成功させる）。
--   設計: docs/roadmap-2026-07.md トラック K Stage 3
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id),
  actor_driver_id uuid,          -- 変更した運営の membership（drivers.id）
  action text NOT NULL,          -- assign_driver / clear_driver / assign_vehicle / loan_on / loan_off / import_apply
  shift_date date,
  course_id uuid,
  slot int,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_change_logs_org_created
  ON shift_change_logs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_change_logs_date
  ON shift_change_logs (shift_date);
