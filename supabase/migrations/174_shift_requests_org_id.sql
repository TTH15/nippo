-- ============================================================
-- 希望休まわりのテーブルに org_id を持たせる（2026-09-18）。
-- 記録: docs/security/2026-09-18-shift-tenant-gaps.md
--
-- 背景: この構成は RLS を使わず（構成A）、テナント分離はアプリ層の `.eq("org_id")` が
-- 支えている。その二重防御である `check:tenant` は **org 列を持つテーブルしか見ない**ため、
-- 列が無いテーブル（本番で103中49）は検査の外にあった。実際 2026-09-18 に
-- 希望休の削除・履歴の閲覧が他社へ届く状態で見つかっている。
--
-- 列を足すと `check:tenant` が自動でこの表を検査対象にする（scanner は migration の
-- SQL から対象表を読む）。つまり「見つけたら直す」から「書き忘れると検査で落ちる」に変わる。
--
-- ★この migration では org_id を **NULL 許容のまま**にする。
--   NOT NULL は「全ての書き込み経路が org_id を入れている」ことを確認してから別の
--   migration で入れる（先に NOT NULL にすると、入れ忘れた経路で希望休の提出が落ちる）。
--   複合外部キーは MATCH SIMPLE なので、org_id が NULL の行では検査されない＝移行中も安全。
--
-- ★複合外部キーには ON UPDATE CASCADE を付ける。付けないと「drivers.org_id を変える」操作が
--   希望休の行に阻まれて失敗する（今のコードに所属変更の経路は無いが、塞いだままにしない）。
--   ON DELETE CASCADE は driver_id 側の既存 FK と同じ挙動を複合側にも揃えるため。
-- ============================================================
BEGIN;

-- 複合外部キーの相手側。drivers(id) は主キーなのでこの索引は冗長だが、
-- (org_id, id) を参照するために一意制約として必要
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_org_id ON public.drivers (org_id, id);

-- ------------------------------------------------------------
-- 希望休そのもの
-- ------------------------------------------------------------
ALTER TABLE public.shift_requests
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

UPDATE public.shift_requests r
   SET org_id = d.org_id
  FROM public.drivers d
 WHERE d.id = r.driver_id AND r.org_id IS DISTINCT FROM d.org_id;

-- 行の org と、そのドライバーの org が食い違えないようにする
ALTER TABLE public.shift_requests DROP CONSTRAINT IF EXISTS shift_requests_org_driver_fk;
ALTER TABLE public.shift_requests
  ADD CONSTRAINT shift_requests_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_shift_requests_org_date
  ON public.shift_requests (org_id, request_date);

COMMENT ON COLUMN public.shift_requests.org_id IS
  'ドライバーの所属。複合外部キーで driver_id と食い違えない。API は必ずこの列で絞る';

-- ------------------------------------------------------------
-- 希望休の変更履歴
-- ------------------------------------------------------------
ALTER TABLE public.shift_request_logs
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

UPDATE public.shift_request_logs l
   SET org_id = d.org_id
  FROM public.drivers d
 WHERE d.id = l.driver_id AND l.org_id IS DISTINCT FROM d.org_id;

ALTER TABLE public.shift_request_logs DROP CONSTRAINT IF EXISTS shift_request_logs_org_driver_fk;
ALTER TABLE public.shift_request_logs
  ADD CONSTRAINT shift_request_logs_org_driver_fk
  FOREIGN KEY (org_id, driver_id) REFERENCES public.drivers (org_id, id)
  ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_shift_request_logs_org_driver_date
  ON public.shift_request_logs (org_id, driver_id, request_date);

COMMENT ON COLUMN public.shift_request_logs.org_id IS
  'ドライバーの所属。複合外部キーで driver_id と食い違えない。API は必ずこの列で絞る';

COMMIT;
