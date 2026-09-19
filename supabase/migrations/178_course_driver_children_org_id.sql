-- ============================================================
-- コース・ドライバーの子表に org_id を持たせる（2026-09-18）。174〜177 の続き。
-- 記録: docs/security/2026-09-18-org-column-rollout.md
--
--   コース子表: course_rates / course_unit_rates / course_fixed_rates /
--               course_fixed_rate_bundles / course_cycles / course_report_fields
--   ドライバー子表: driver_courses / driver_request_slots / driver_vehicle_preferences
--
-- いずれも org 列が無く `check:tenant` の検査対象外だった。単価は金額に直結する。
--
-- ★org_id は **NULL 許容のまま**（174〜177 と同じ）。
-- ★複合外部キーの ON DELETE は既存の単独FK（全て CASCADE）にそろえる。
-- ★driver_courses だけは親が2つ（drivers と courses）。両方に複合外部キーを張り、
--   「他社のコースを自社ドライバーの担当にする」も「その逆」も通らないようにする。
--   2026-09-18 時点で横断参照は0件であることを本番で確認済み。
-- ============================================================
-- ★2026-09-19 追記: ここで張った複合外部キーは **migration 180 で外した**。
--   既存の単一列FKと合わせて「同じ親への関係が2本」になり、PostgREST の埋め込みが
--   曖昧になって本番が 500（PGRST201）になったため。org_id 列・索引・backfill は残す。
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_org_id ON public.drivers (org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_org_id ON public.courses (org_id, id);

-- course_rates ---------------------------------------------------
ALTER TABLE public.course_rates
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.course_rates x SET org_id = p.org_id
  FROM public.courses p WHERE p.id = x.course_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.course_rates DROP CONSTRAINT IF EXISTS course_rates_org_fk;
ALTER TABLE public.course_rates
  ADD CONSTRAINT course_rates_org_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_course_rates_org ON public.course_rates (org_id);
COMMENT ON COLUMN public.course_rates.org_id IS
  'コースの所属。複合外部キーで course_id と食い違えない。API は必ずこの列で絞る';

-- course_unit_rates ---------------------------------------------------
ALTER TABLE public.course_unit_rates
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.course_unit_rates x SET org_id = p.org_id
  FROM public.courses p WHERE p.id = x.course_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.course_unit_rates DROP CONSTRAINT IF EXISTS course_unit_rates_org_fk;
ALTER TABLE public.course_unit_rates
  ADD CONSTRAINT course_unit_rates_org_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_course_unit_rates_org ON public.course_unit_rates (org_id);
COMMENT ON COLUMN public.course_unit_rates.org_id IS
  'コースの所属。複合外部キーで course_id と食い違えない。API は必ずこの列で絞る';

-- course_fixed_rates ---------------------------------------------------
ALTER TABLE public.course_fixed_rates
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.course_fixed_rates x SET org_id = p.org_id
  FROM public.courses p WHERE p.id = x.course_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.course_fixed_rates DROP CONSTRAINT IF EXISTS course_fixed_rates_org_fk;
ALTER TABLE public.course_fixed_rates
  ADD CONSTRAINT course_fixed_rates_org_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_course_fixed_rates_org ON public.course_fixed_rates (org_id);
COMMENT ON COLUMN public.course_fixed_rates.org_id IS
  'コースの所属。複合外部キーで course_id と食い違えない。API は必ずこの列で絞る';

-- course_fixed_rate_bundles ---------------------------------------------------
ALTER TABLE public.course_fixed_rate_bundles
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.course_fixed_rate_bundles x SET org_id = p.org_id
  FROM public.courses p WHERE p.id = x.course_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.course_fixed_rate_bundles DROP CONSTRAINT IF EXISTS course_fixed_rate_bundles_org_fk;
ALTER TABLE public.course_fixed_rate_bundles
  ADD CONSTRAINT course_fixed_rate_bundles_org_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_course_fixed_rate_bundles_org ON public.course_fixed_rate_bundles (org_id);
COMMENT ON COLUMN public.course_fixed_rate_bundles.org_id IS
  'コースの所属。複合外部キーで course_id と食い違えない。API は必ずこの列で絞る';

-- course_cycles ---------------------------------------------------
ALTER TABLE public.course_cycles
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.course_cycles x SET org_id = p.org_id
  FROM public.courses p WHERE p.id = x.course_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.course_cycles DROP CONSTRAINT IF EXISTS course_cycles_org_fk;
ALTER TABLE public.course_cycles
  ADD CONSTRAINT course_cycles_org_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_course_cycles_org ON public.course_cycles (org_id);
COMMENT ON COLUMN public.course_cycles.org_id IS
  'コースの所属。複合外部キーで course_id と食い違えない。API は必ずこの列で絞る';

-- course_report_fields ---------------------------------------------------
ALTER TABLE public.course_report_fields
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.course_report_fields x SET org_id = p.org_id
  FROM public.courses p WHERE p.id = x.course_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.course_report_fields DROP CONSTRAINT IF EXISTS course_report_fields_org_fk;
ALTER TABLE public.course_report_fields
  ADD CONSTRAINT course_report_fields_org_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_course_report_fields_org ON public.course_report_fields (org_id);
COMMENT ON COLUMN public.course_report_fields.org_id IS
  'コースの所属。複合外部キーで course_id と食い違えない。API は必ずこの列で絞る';

-- driver_request_slots ---------------------------------------------------
ALTER TABLE public.driver_request_slots
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.driver_request_slots x SET org_id = p.org_id
  FROM public.drivers p WHERE p.id = x.driver_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.driver_request_slots DROP CONSTRAINT IF EXISTS driver_request_slots_org_fk;
ALTER TABLE public.driver_request_slots
  ADD CONSTRAINT driver_request_slots_org_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_driver_request_slots_org ON public.driver_request_slots (org_id);
COMMENT ON COLUMN public.driver_request_slots.org_id IS
  'ドライバーの所属。複合外部キーで driver_id と食い違えない。API は必ずこの列で絞る';

-- driver_vehicle_preferences ---------------------------------------------------
ALTER TABLE public.driver_vehicle_preferences
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.driver_vehicle_preferences x SET org_id = p.org_id
  FROM public.drivers p WHERE p.id = x.driver_id AND x.org_id IS DISTINCT FROM p.org_id;
ALTER TABLE public.driver_vehicle_preferences DROP CONSTRAINT IF EXISTS driver_vehicle_preferences_org_fk;
ALTER TABLE public.driver_vehicle_preferences
  ADD CONSTRAINT driver_vehicle_preferences_org_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_driver_vehicle_preferences_org ON public.driver_vehicle_preferences (org_id);
COMMENT ON COLUMN public.driver_vehicle_preferences.org_id IS
  'ドライバーの所属。複合外部キーで driver_id と食い違えない。API は必ずこの列で絞る';

-- driver_courses（親が2つ） -------------------------------
ALTER TABLE public.driver_courses
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
UPDATE public.driver_courses x SET org_id = d.org_id
  FROM public.drivers d WHERE d.id = x.driver_id AND x.org_id IS DISTINCT FROM d.org_id;
ALTER TABLE public.driver_courses DROP CONSTRAINT IF EXISTS driver_courses_org_driver_fk;
ALTER TABLE public.driver_courses
  ADD CONSTRAINT driver_courses_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.driver_courses DROP CONSTRAINT IF EXISTS driver_courses_org_course_fk;
ALTER TABLE public.driver_courses
  ADD CONSTRAINT driver_courses_org_course_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_driver_courses_org ON public.driver_courses (org_id);
COMMENT ON COLUMN public.driver_courses.org_id IS
  'ドライバーとコースの所属。両方に複合外部キーを張り、他社をまたぐ担当を作れないようにする';

COMMIT;
