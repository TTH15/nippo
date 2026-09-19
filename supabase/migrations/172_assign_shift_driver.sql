-- ============================================================
-- 通常のシフト編集にも競合検知と監査履歴を入れる（2026-09-18）。
-- 設計: docs/design/operational-risk-detection-2026-09.md O-3
--
-- これまで /api/admin/shifts の POST は、読み取った版を条件にせず upsert していた。
-- 2人の管理者が同じセルを触ると**黙って後勝ち**になり、消えた側は気づけない。
-- 変更ログも `void logShiftChange(...)` の投げっぱなしで、失敗しても保存は成功し、
-- さらに便番号（cycle_no）が渡っていないため、便を使うコースのログは全部 0 になっていた。
--
-- ここでは1セルの割当を
--   1) 対象行を FOR UPDATE で押さえ
--   2) 呼び出し側が画面で見ていた値（p_expect_driver_id）と今の値を照合し
--   3) 一致したときだけ保存して、変更ログを**同じトランザクション**で残す
-- という1つの関数にまとめる。165（メモ反映）と同じ考え方。
--
-- p_expect_present=false で呼ぶと従来どおり無条件保存になる（古いクライアント向け）。
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.assign_shift_driver(
  p_org_id uuid,
  p_actor_id uuid,
  p_date date,
  p_course_id uuid,
  p_cycle_no int,
  p_slot int,
  p_driver_id uuid,
  p_expect_driver_id uuid DEFAULT NULL,
  p_expect_present boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $$
DECLARE
  v_before uuid;
  v_row public.shifts%ROWTYPE;
BEGIN
  -- ここは P0001（アプリの判断）で返す。42501 は「関数のEXECUTE権限が無い」という
  -- 環境側の失敗を表すので、呼び出し側が両者を区別できるように分けておく
  IF p_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM drivers WHERE id = p_actor_id AND org_id = p_org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Invalid organization or actor' USING ERRCODE = 'P0001';
  END IF;
  IF p_date IS NULL OR p_course_id IS NULL OR p_cycle_no IS NULL OR p_cycle_no < 0
     OR p_slot IS NULL OR p_slot < 1 THEN
    RAISE EXCEPTION 'Invalid input' USING ERRCODE = '22023';
  END IF;

  -- コースと便が自社の有効な枠か（165 と同じ判定）
  IF NOT EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = p_course_id AND c.org_id = p_org_id AND c.archived_at IS NULL
      AND ((NOT coalesce(c.uses_cycles, false) AND p_cycle_no = 0)
        OR (c.uses_cycles AND EXISTS (
          SELECT 1 FROM course_cycles cc
          WHERE cc.course_id = c.id AND cc.cycle_no = p_cycle_no AND cc.active IS DISTINCT FROM false)))
  ) THEN
    RAISE EXCEPTION 'Course or cycle is unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF p_driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM drivers d
    WHERE d.id = p_driver_id AND d.org_id = p_org_id AND d.status = 'active' AND d.works_as_driver
  ) THEN
    RAISE EXCEPTION 'Driver is unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- 対象セルを押さえる。行が無ければ v_before は NULL のまま
  SELECT s.driver_id INTO v_before
  FROM shifts s
  WHERE s.shift_date = p_date AND s.course_id = p_course_id
    AND s.cycle_no = p_cycle_no AND s.slot = p_slot
  FOR UPDATE;

  -- 画面で見ていた値と今の値が違う＝この間に誰かが変えた
  IF p_expect_present AND (v_before IS DISTINCT FROM p_expect_driver_id) THEN
    RAISE EXCEPTION 'Shift changed since it was loaded' USING ERRCODE = '40001';
  END IF;

  INSERT INTO shifts AS s (shift_date, course_id, cycle_no, slot, driver_id, vehicle_id, uses_external_vehicle, updated_at)
  VALUES (
    p_date, p_course_id, p_cycle_no, p_slot, p_driver_id,
    NULL, false, now()
  )
  ON CONFLICT (shift_date, course_id, cycle_no, slot) DO UPDATE SET
    driver_id = EXCLUDED.driver_id,
    -- ドライバーを外した行に車両だけ残ると配車表示が浮くので連動クリア。
    -- 個別時刻も一緒に消す。残っていると 165（メモ反映）の
    -- 「車両・個別時刻・取込元のない空枠だけを再利用する」に当たらず、枠が増えたまま戻らない。
    --
    -- ★ import_batch_id は**消さない**。取り込みの取り消し（import/batches/[id]/revert）は
    --   `DELETE FROM shifts WHERE import_batch_id = <batch>` で消すので、ここで NULL にすると
    --   手で編集した行だけ取り消せず盤面に残る。取込由来の枠は取り消しで片付ける前提を守る。
    --   そのぶん、取込由来の空枠は 165 の再利用対象にはならない。
    vehicle_id = CASE WHEN EXCLUDED.driver_id IS NULL THEN NULL ELSE s.vehicle_id END,
    uses_external_vehicle = CASE WHEN EXCLUDED.driver_id IS NULL THEN false ELSE s.uses_external_vehicle END,
    meeting_place = CASE WHEN EXCLUDED.driver_id IS NULL THEN NULL ELSE s.meeting_place END,
    meeting_time = CASE WHEN EXCLUDED.driver_id IS NULL THEN NULL ELSE s.meeting_time END,
    arrival_time = CASE WHEN EXCLUDED.driver_id IS NULL THEN NULL ELSE s.arrival_time END,
    end_time = CASE WHEN EXCLUDED.driver_id IS NULL THEN NULL ELSE s.end_time END,
    updated_at = now()
  -- 押さえた後に割り込まれた場合の保険（一意索引で直列化される）
  WHERE NOT p_expect_present OR s.driver_id IS NOT DISTINCT FROM p_expect_driver_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Shift changed since it was loaded' USING ERRCODE = '40001';
  END IF;

  -- 変更ログは同じトランザクション。失敗したら保存もしない（ログの欠けた変更を残さない）
  IF v_before IS DISTINCT FROM p_driver_id THEN
    INSERT INTO shift_change_logs (org_id, actor_driver_id, action, shift_date, course_id, cycle_no, slot, before, after)
    VALUES (
      p_org_id, p_actor_id,
      CASE WHEN p_driver_id IS NULL THEN 'clear_driver' ELSE 'assign_driver' END,
      p_date, p_course_id, p_cycle_no, p_slot,
      jsonb_build_object('driverId', v_before),
      jsonb_build_object('driverId', p_driver_id)
    );
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_shift_driver(uuid, uuid, date, uuid, int, int, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_shift_driver(uuid, uuid, date, uuid, int, int, uuid, uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION public.assign_shift_driver(uuid, uuid, date, uuid, int, int, uuid, uuid, boolean) IS
  'シフト1セルの割当。画面で見ていた値と照合して後勝ちを防ぎ、変更ログを同じトランザクションで残す';

COMMIT;
