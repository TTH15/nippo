-- ============================================================
-- ドライバーの金額まわり4表に org_id を持たせる（2026-09-18）。174 / 175 の続き。
-- 記録: docs/security/2026-09-18-shift-tenant-gaps.md
--
--   driver_ad_hoc_expenses / driver_fixed_expenses / driver_optional_expenses / driver_leases
--
-- いずれも driver_id (NOT NULL) 経由でしか会社が決まらず、org 列が無いため
-- `check:tenant` の検査対象外だった。金額と個人が結びつく表なので先に載せる。
--
-- ★org_id は **NULL 許容のまま**にする（174 / 175 と同じ）。NOT NULL は全ての書き込み
--   経路が org_id を入れていることを確認してから別の migration で入れる。
-- ★複合外部キーの ON DELETE は既存の driver_id 側（全て ON DELETE CASCADE）にそろえる。
--   ON UPDATE CASCADE はドライバーの所属変更を塞がないため。
-- ★2026-09-18 時点で、4表とも所属不明のドライバーを指す行は0件であることを確認済み。
-- ============================================================
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_org_id ON public.drivers (org_id, id);

-- driver_ad_hoc_expenses ---------------------------------------------------
ALTER TABLE public.driver_ad_hoc_expenses
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.driver_ad_hoc_expenses e SET org_id = d.org_id
  FROM public.drivers d WHERE d.id = e.driver_id AND e.org_id IS DISTINCT FROM d.org_id;
ALTER TABLE public.driver_ad_hoc_expenses DROP CONSTRAINT IF EXISTS driver_ad_hoc_expenses_org_driver_fk;
ALTER TABLE public.driver_ad_hoc_expenses
  ADD CONSTRAINT driver_ad_hoc_expenses_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_driver_ad_hoc_expenses_org_month
  ON public.driver_ad_hoc_expenses (org_id, month);

-- driver_fixed_expenses ----------------------------------------------------
ALTER TABLE public.driver_fixed_expenses
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.driver_fixed_expenses e SET org_id = d.org_id
  FROM public.drivers d WHERE d.id = e.driver_id AND e.org_id IS DISTINCT FROM d.org_id;
ALTER TABLE public.driver_fixed_expenses DROP CONSTRAINT IF EXISTS driver_fixed_expenses_org_driver_fk;
ALTER TABLE public.driver_fixed_expenses
  ADD CONSTRAINT driver_fixed_expenses_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_driver_fixed_expenses_org_driver
  ON public.driver_fixed_expenses (org_id, driver_id);

-- driver_optional_expenses -------------------------------------------------
ALTER TABLE public.driver_optional_expenses
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.driver_optional_expenses e SET org_id = d.org_id
  FROM public.drivers d WHERE d.id = e.driver_id AND e.org_id IS DISTINCT FROM d.org_id;
ALTER TABLE public.driver_optional_expenses DROP CONSTRAINT IF EXISTS driver_optional_expenses_org_driver_fk;
ALTER TABLE public.driver_optional_expenses
  ADD CONSTRAINT driver_optional_expenses_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_driver_optional_expenses_org_month
  ON public.driver_optional_expenses (org_id, month);

-- driver_leases ------------------------------------------------------------
ALTER TABLE public.driver_leases
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.driver_leases e SET org_id = d.org_id
  FROM public.drivers d WHERE d.id = e.driver_id AND e.org_id IS DISTINCT FROM d.org_id;
ALTER TABLE public.driver_leases DROP CONSTRAINT IF EXISTS driver_leases_org_driver_fk;
ALTER TABLE public.driver_leases
  ADD CONSTRAINT driver_leases_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_driver_leases_org_driver
  ON public.driver_leases (org_id, driver_id);

COMMIT;
