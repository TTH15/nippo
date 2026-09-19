-- ============================================================
-- 日報まわり2表に org_id を持たせる（2026-09-18）。174〜176 の続き。
-- 記録: docs/security/2026-09-18-org-column-rollout.md
--
--   report_entries  … 日報(v2)の明細（縦持ち）。親は daily_reports_v2（org_id を持つ）
--   daily_reports   … 旧日報。親は drivers
--
-- どちらも org 列が無いため `check:tenant` の検査対象外だった。
--
-- ★org_id は **NULL 許容のまま**にする（174〜176 と同じ）。
-- ★複合外部キーの ON DELETE は既存の単独FKにそろえる（どちらも CASCADE）。
-- ★2026-09-18 時点で、親をたどれない行・所属不明の行は0件であることを本番で確認済み
--   （report_entries 9,391行 / daily_reports 614行）。
-- ============================================================
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_org_id ON public.drivers (org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_reports_v2_org_id ON public.daily_reports_v2 (org_id, id);

-- ------------------------------------------------------------
-- report_entries（日報v2の明細）
-- ------------------------------------------------------------
ALTER TABLE public.report_entries
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

UPDATE public.report_entries e SET org_id = v.org_id
  FROM public.daily_reports_v2 v WHERE v.id = e.report_id AND e.org_id IS DISTINCT FROM v.org_id;

ALTER TABLE public.report_entries DROP CONSTRAINT IF EXISTS report_entries_org_report_fk;
ALTER TABLE public.report_entries
  ADD CONSTRAINT report_entries_org_report_fk
  FOREIGN KEY (org_id, report_id) REFERENCES public.daily_reports_v2 (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_report_entries_org_report
  ON public.report_entries (org_id, report_id);

COMMENT ON COLUMN public.report_entries.org_id IS
  '日報(v2)の所属。複合外部キーで report_id と食い違えない。API は必ずこの列で絞る';

-- ------------------------------------------------------------
-- daily_reports（旧日報）
-- ------------------------------------------------------------
ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

UPDATE public.daily_reports r SET org_id = d.org_id
  FROM public.drivers d WHERE d.id = r.driver_id AND r.org_id IS DISTINCT FROM d.org_id;

ALTER TABLE public.daily_reports DROP CONSTRAINT IF EXISTS daily_reports_org_driver_fk;
ALTER TABLE public.daily_reports
  ADD CONSTRAINT daily_reports_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_daily_reports_org_date
  ON public.daily_reports (org_id, report_date);

COMMENT ON COLUMN public.daily_reports.org_id IS
  'ドライバーの所属。複合外部キーで driver_id と食い違えない。API は必ずこの列で絞る';

COMMIT;
