-- シフトの解除・担当変更・取込取消で、該当日報を履歴に残して集計対象外にする。
-- 過去データの一括修正はしない。履歴と明細・単価スナップショットは保持する。
BEGIN;
SET LOCAL lock_timeout = '2s';
LOCK TABLE public.shifts, public.daily_reports_v2 IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.daily_reports_v2 ADD COLUMN rejection_reason text
  CHECK (rejection_reason IS NULL OR rejection_reason = 'shift_changed');

-- 通常のシフト書込ロールへ日報更新権限を渡さない。トリガーだけの最小権限。
CREATE ROLE hakotora_shift_report_sync NOLOGIN NOINHERIT NOBYPASSRLS
  NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO hakotora_shift_report_sync;
-- Supabaseの非superuser管理者でも所有者を限定できるよう、DDL中だけSET/CREATEを許可。
GRANT hakotora_shift_report_sync TO CURRENT_USER WITH SET TRUE;
GRANT CREATE ON SCHEMA public TO hakotora_shift_report_sync;
GRANT SELECT(id, org_id) ON public.courses TO hakotora_shift_report_sync;
GRANT SELECT(org_id, driver_id, shift_date, course_id, cycle_no) ON public.shifts TO hakotora_shift_report_sync;
GRANT SELECT(org_id, driver_id, report_date, course_id, cycle_no, rejected_at, rejection_reason)
  ON public.daily_reports_v2 TO hakotora_shift_report_sync;
GRANT UPDATE(approved_at, approved_by, rejected_at, rejected_by, rejection_reason)
  ON public.daily_reports_v2 TO hakotora_shift_report_sync;
-- RLS の有無に依存しない。通常のAPIロールには適用されない内部専用ポリシー。
CREATE POLICY shift_report_sync_read ON public.courses FOR SELECT TO hakotora_shift_report_sync USING (true);
CREATE POLICY shift_report_sync_read ON public.shifts FOR SELECT TO hakotora_shift_report_sync USING (true);
CREATE POLICY shift_report_sync_read ON public.daily_reports_v2 FOR SELECT TO hakotora_shift_report_sync USING (true);
CREATE POLICY shift_report_sync_reject ON public.daily_reports_v2 FOR UPDATE TO hakotora_shift_report_sync
  USING (true) WITH CHECK (rejected_at IS NOT NULL AND approved_at IS NULL AND approved_by IS NULL AND rejected_by IS NULL);

-- 送信処理と同じ org/driver/date/course/cycle のロックを解除側でも取る。
CREATE FUNCTION public.lock_shift_report_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE org uuid;
BEGIN
  IF OLD.driver_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.org_id, OLD.driver_id, OLD.shift_date, OLD.course_id, OLD.cycle_no)
      IS NOT DISTINCT FROM (NEW.org_id, NEW.driver_id, NEW.shift_date, NEW.course_id, NEW.cycle_no)
    THEN RETURN NEW; END IF;
  END IF;
  org := OLD.org_id;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Shift/report changes require READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  IF org IS NULL THEN SELECT c.org_id INTO org FROM public.courses c WHERE c.id = OLD.course_id; END IF;
  IF org IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(org::text || ':' || OLD.driver_id::text || ':' || OLD.shift_date::text || ':' || OLD.course_id::text || ':' || COALESCE(OLD.cycle_no, 0)::text, 0));
    -- 旧全体日報(cycle=0)への再送とも直列化する。
    IF COALESCE(OLD.cycle_no, 0) <> 0 THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(org::text || ':' || OLD.driver_id::text || ':' || OLD.shift_date::text || ':' || OLD.course_id::text || ':0', 0));
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE FUNCTION public.reject_reports_for_removed_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE org uuid;
BEGIN
  IF OLD.driver_id IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.org_id, OLD.driver_id, OLD.shift_date, OLD.course_id, OLD.cycle_no)
      IS NOT DISTINCT FROM (NEW.org_id, NEW.driver_id, NEW.shift_date, NEW.course_id, NEW.cycle_no)
    THEN RETURN NULL; END IF;
  END IF;
  org := OLD.org_id;
  IF org IS NULL THEN SELECT c.org_id INTO org FROM public.courses c WHERE c.id = OLD.course_id; END IF;
  IF org IS NULL THEN RETURN NULL; END IF;
  -- 同じ便に別スロットが残る場合、あるいは同一トランザクション内の移動は保持。
  IF EXISTS (
    SELECT FROM public.shifts s JOIN public.courses c ON c.id = s.course_id
    WHERE c.org_id = org AND s.driver_id = OLD.driver_id AND s.shift_date = OLD.shift_date
      AND s.course_id = OLD.course_id AND COALESCE(s.cycle_no, 0) = COALESCE(OLD.cycle_no, 0)
  ) THEN RETURN NULL; END IF;
  UPDATE public.daily_reports_v2 r
  SET approved_at = NULL, approved_by = NULL, rejected_at = clock_timestamp(), rejected_by = NULL, rejection_reason = 'shift_changed'
  WHERE r.org_id = org AND r.driver_id = OLD.driver_id AND r.report_date = OLD.shift_date
    AND r.course_id = OLD.course_id AND (COALESCE(r.cycle_no, 0) = COALESCE(OLD.cycle_no, 0) OR COALESCE(r.cycle_no, 0) = 0)
    AND r.rejected_at IS NULL;
  RETURN NULL;
END $$;

-- 古い入力画面からの再送や、承認との競合で解除済み日報を復活させない。
-- 承認取消・却下・メーター補正等は妨げず、コース未特定の移行前履歴は維持。
CREATE FUNCTION public.guard_report_current_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.course_id IS NULL OR NEW.rejected_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.rejection_reason = 'shift_changed' THEN
      RAISE EXCEPTION 'シフトが変更された日報は再利用できません。最新のシフトから入力し直してください。'
        USING ERRCODE = '23514', CONSTRAINT = 'report_current_shift';
    END IF;
    IF NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
      AND NOT (NEW.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at)
      AND OLD.rejected_at IS NULL
      AND (NEW.org_id, NEW.driver_id, NEW.report_date, NEW.course_id, NEW.cycle_no)
        IS NOT DISTINCT FROM (OLD.org_id, OLD.driver_id, OLD.report_date, OLD.course_id, OLD.cycle_no)
    THEN RETURN NEW; END IF;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Shift/report changes require READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  -- UPDATE は BEFORE トリガーより先に日報行をロックする。解除側がすでに
  -- キーを保持していれば待たずに再入力へ戻し、相互の行待ちを作らない。
  IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW.org_id::text || ':' || NEW.driver_id::text || ':' || NEW.report_date::text || ':' || NEW.course_id::text || ':' || COALESCE(NEW.cycle_no, 0)::text, 0)) THEN
    RAISE EXCEPTION 'シフトが変更されています。最新のシフトを確認して日報を入力し直してください。'
      USING ERRCODE = '23514', CONSTRAINT = 'report_current_shift';
  END IF;
  IF NOT EXISTS (
    SELECT FROM public.shifts s JOIN public.courses c ON c.id = s.course_id
    WHERE c.org_id = NEW.org_id AND s.driver_id = NEW.driver_id AND s.shift_date = NEW.report_date
      AND s.course_id = NEW.course_id AND (COALESCE(s.cycle_no, 0) = COALESCE(NEW.cycle_no, 0)
        OR (TG_OP = 'UPDATE' AND COALESCE(OLD.cycle_no, 0) = 0 AND COALESCE(NEW.cycle_no, 0) = 0))
  ) THEN
    RAISE EXCEPTION 'シフトが変更されています。最新のシフトを確認して日報を入力し直してください。'
      USING ERRCODE = '23514', CONSTRAINT = 'report_current_shift';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION public.lock_shift_report_removal() OWNER TO hakotora_shift_report_sync;
ALTER FUNCTION public.reject_reports_for_removed_shift() OWNER TO hakotora_shift_report_sync;
ALTER FUNCTION public.guard_report_current_shift() OWNER TO hakotora_shift_report_sync;
REVOKE ALL ON FUNCTION public.lock_shift_report_removal(), public.reject_reports_for_removed_shift(), public.guard_report_current_shift()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER lock_shift_report_removal BEFORE UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.lock_shift_report_removal();
CREATE CONSTRAINT TRIGGER reject_reports_for_removed_shift AFTER UPDATE OR DELETE ON public.shifts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.reject_reports_for_removed_shift();
CREATE TRIGGER guard_report_current_shift BEFORE INSERT OR UPDATE ON public.daily_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_current_shift();

-- 対応待ちの日付・管理バッジもコース＋便で判定する。旧全体日報のみ互換扱い。
CREATE OR REPLACE FUNCTION admin_daily_pending_dates(p_org uuid, p_start date, p_end date)
RETURNS SETOF date
LANGUAGE sql
STABLE
AS $$
  WITH org_drivers AS (
    SELECT id FROM drivers
    WHERE org_id = p_org AND works_as_driver = true
  ),
  sh AS (
    SELECT s.shift_date, s.driver_id, s.course_id, COALESCE(s.cycle_no, 0) AS cycle_no
    FROM shifts s
    JOIN org_drivers d ON d.id = s.driver_id
    WHERE s.shift_date BETWEEN p_start AND p_end
  ),
  rep AS (
    SELECT r.report_date, r.driver_id, r.course_id, COALESCE(r.cycle_no, 0) AS cycle_no, r.approved_at
    FROM daily_reports_v2 r
    WHERE r.org_id = p_org
      AND r.report_date BETWEEN p_start AND p_end
      AND r.rejected_at IS NULL
  ),
  cells AS (
    SELECT DISTINCT shift_date, driver_id FROM sh
  )
  SELECT DISTINCT t.d
  FROM (
    -- ① 未承認の日報がある日
    SELECT r.report_date AS d FROM rep r WHERE r.approved_at IS NULL
    UNION
    -- ② シフトがあるのに日報ゼロ／一部コース未提出の日
    SELECT c.shift_date AS d
    FROM cells c
    WHERE
      NOT EXISTS (
        SELECT 1 FROM rep r
        WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
      )
      OR EXISTS (
        SELECT 1 FROM sh
        WHERE sh.shift_date = c.shift_date AND sh.driver_id = c.driver_id
          AND sh.course_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM rep r
            WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
              AND r.course_id = sh.course_id
              AND (r.cycle_no = sh.cycle_no OR (r.cycle_no = 0 AND NOT EXISTS (
                SELECT FROM rep split WHERE split.report_date = r.report_date AND split.driver_id = r.driver_id
                  AND split.course_id = r.course_id AND split.cycle_no > 0)))
          )
      )
  ) t
  ORDER BY 1;
$$;

COMMENT ON FUNCTION admin_daily_pending_dates(uuid, date, date) IS
  '日報の要対応（未提出/一部コース未提出/未承認）が残る日付の一覧。要対応ビュー用';

CREATE OR REPLACE FUNCTION admin_daily_unread_count(p_org uuid, p_start date, p_end date)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH org_drivers AS (
    SELECT id FROM drivers
    WHERE org_id = p_org AND works_as_driver = true
  ),
  sh AS (
    SELECT s.shift_date, s.driver_id, s.course_id, COALESCE(s.cycle_no, 0) AS cycle_no
    FROM shifts s
    JOIN org_drivers d ON d.id = s.driver_id
    WHERE s.shift_date BETWEEN p_start AND p_end
  ),
  rep AS (
    SELECT r.report_date, r.driver_id, r.course_id, COALESCE(r.cycle_no, 0) AS cycle_no, r.approved_at
    FROM daily_reports_v2 r
    WHERE r.org_id = p_org
      AND r.report_date BETWEEN p_start AND p_end
      AND r.rejected_at IS NULL
  ),
  cells AS (
    SELECT DISTINCT shift_date, driver_id FROM sh
  )
  SELECT COALESCE(count(*), 0)::int
  FROM cells c
  WHERE
    -- ① 日報未提出
    NOT EXISTS (
      SELECT 1 FROM rep r
      WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
    )
    -- ② 一部コース未提出
    OR EXISTS (
      SELECT 1 FROM sh
      WHERE sh.shift_date = c.shift_date AND sh.driver_id = c.driver_id
        AND sh.course_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM rep r
          WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
            AND r.course_id = sh.course_id
              AND (r.cycle_no = sh.cycle_no OR (r.cycle_no = 0 AND NOT EXISTS (
                SELECT FROM rep split WHERE split.report_date = r.report_date AND split.driver_id = r.driver_id
                  AND split.course_id = r.course_id AND split.cycle_no > 0)))
        )
    )
    -- ③ 未承認あり
    OR EXISTS (
      SELECT 1 FROM rep r
      WHERE r.report_date = c.shift_date AND r.driver_id = c.driver_id
        AND r.approved_at IS NULL
    );
$$;

COMMENT ON FUNCTION admin_daily_unread_count(uuid, date, date) IS
  '日報の要対応件数（未提出/一部コース未提出/未承認のシフト×日セル数）。管理バッジ用';

REVOKE CREATE ON SCHEMA public FROM hakotora_shift_report_sync;
GRANT hakotora_shift_report_sync TO CURRENT_USER WITH SET FALSE;
COMMIT;
