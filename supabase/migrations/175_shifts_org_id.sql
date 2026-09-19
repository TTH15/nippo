-- ============================================================
-- shifts に org_id を持たせる（2026-09-18）。174 の続き。
-- 記録: docs/security/2026-09-18-shift-tenant-gaps.md
--
-- shifts は「コースに属す」ことで会社が決まる（course_id は NOT NULL）。org 列が無いため
-- `check:tenant` の対象外で、実際 POST /api/admin/shifts/times が他社のシフト時刻を
-- 書き換えられる状態になっていた。列を足して検査対象に載せる。
--
-- ★174 と同じく org_id は **NULL 許容のまま**にする。NOT NULL は全ての書き込み経路が
--   org_id を入れていることを確認してから別の migration で入れる。
-- ============================================================
BEGIN;

-- 複合外部キーの相手側。drivers 側は 174 でも作るが、適用順に依存しないようここでも作る
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_org_id ON public.courses (org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_org_id ON public.drivers (org_id, id);

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

-- コース経由で backfill（course_id は NOT NULL なので全行が埋まる）
UPDATE public.shifts s
   SET org_id = c.org_id
  FROM public.courses c
 WHERE c.id = s.course_id AND s.org_id IS DISTINCT FROM c.org_id;

-- 会社の決定元はコース。course 側の ON DELETE CASCADE に挙動をそろえる。
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_org_course_fk;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_org_course_fk
  FOREIGN KEY (org_id, course_id) REFERENCES public.courses (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- 他社のドライバーを割り当てられないようにする。driver_id は NULL 可で、
-- 複合外部キーは MATCH SIMPLE なので未割当の行では検査されない。
-- ★ON DELETE は既存の shifts_driver_id_fkey と同じ SET NULL にそろえる。列を指定しないと
--   org_id まで NULL になるため、PG15 以降の列指定形で driver_id だけを NULL にする。
--   （本番は PostgreSQL 17。2026-09-18 時点で他社参照の行は0件であることを確認済み）
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_org_driver_fk;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE SET NULL (driver_id);

CREATE INDEX IF NOT EXISTS idx_shifts_org_date ON public.shifts (org_id, shift_date);

COMMENT ON COLUMN public.shifts.org_id IS
  'コースの所属。複合外部キーで course_id / driver_id と食い違えない。API は必ずこの列で絞る';

COMMIT;
