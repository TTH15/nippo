-- ============================================================
-- 便（shift_request_slots）に「作った会社」を持たせる（2026-09-19）。
-- 記録: docs/security/2026-09-18-org-column-rollout.md
--
-- 便は org 列を持たない**完全な共有マスタ**だった（本番3件: 1便 / 2便 / 4便）。
-- そのため保存処理が「一覧に無い便を全部消す」「割当を全部消す」を全社横断で行い、
-- A社の保存でB社の便と割当（＋CASCADE でB社の希望休）が消える状態だった。
--
-- ★方針（2026-09-19 ユーザー判断）: 便は**共有のまま**にする。元請→下請へ設定が伝わる
--   構造を保ちたいため、他社の便も見えるし、自社ドライバーへ割り当てても構わない。
--   変えるのは **「直す・消す」は作った会社だけ** という一点。
--
-- ★owner_org_id は NULL 許容。NULL = 持ち主のいない共有便で、**どの会社からも編集・削除
--   できない**（読み取り専用）扱いにする。既存3件は割当先のドライバーの所属で backfill
--   するため、適用直後に NULL は残らない（2026-09-19 時点で確認済み）。
-- ============================================================
BEGIN;

ALTER TABLE public.shift_request_slots
  ADD COLUMN IF NOT EXISTS owner_org_id uuid REFERENCES public.organizations(id);

-- 割り当てられているドライバーの所属を持ち主とする。
-- 複数社にまたがって割り当てられている便は決められないので NULL のまま残す。
UPDATE public.shift_request_slots s
   SET owner_org_id = t.org_id
  FROM (
    SELECT ds.slot_id, min(d.org_id::text)::uuid AS org_id
      FROM public.driver_request_slots ds
      JOIN public.drivers d ON d.id = ds.driver_id
     WHERE d.org_id IS NOT NULL
     GROUP BY ds.slot_id
    HAVING count(DISTINCT d.org_id) = 1
  ) t
 WHERE t.slot_id = s.id AND s.owner_org_id IS DISTINCT FROM t.org_id;

-- 割当が無い便は、希望休から所属をたどる（同じく1社に定まるときだけ）。
UPDATE public.shift_request_slots s
   SET owner_org_id = t.org_id
  FROM (
    SELECT r.slot_id, min(d.org_id::text)::uuid AS org_id
      FROM public.shift_requests r
      JOIN public.drivers d ON d.id = r.driver_id
     WHERE r.slot_id IS NOT NULL AND d.org_id IS NOT NULL
     GROUP BY r.slot_id
    HAVING count(DISTINCT d.org_id) = 1
  ) t
 WHERE t.slot_id = s.id AND s.owner_org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_shift_request_slots_owner
  ON public.shift_request_slots (owner_org_id);

COMMENT ON COLUMN public.shift_request_slots.owner_org_id IS
  '便を作った会社。編集・削除はこの会社だけができる。閲覧と自社ドライバーへの割り当ては全社可（元請→下請の共有を保つため）。NULL = 持ち主不明の共有便で編集不可';

COMMIT;
