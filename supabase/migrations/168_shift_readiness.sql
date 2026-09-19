-- ============================================================
-- 予定が当日までに「合っている」ことを確かめるための土台（2026-09-17）。
-- 設計: docs/design/operational-risk-detection-2026-09.md O-1
--
-- これまで日別の必要人数は個人メモ盤の端末保存で、正式シフト側には共有の基準が無かった。
-- そのため「全員の配置が抜けた日」は不足として検知できず、空白が「休み」なのか
-- 「まだ入力していない」のか「人数が決まっていない」のかも区別できなかった。
--
-- ここで足すのは3つ。
--   1) shift_staffing_requirements … 配置とは別に、日×コース×便の必要人数を共有する
--   2) shift_plan_confirmations    … 本人が「その版の予定」を確認したかどうか
--   3) shift_import_batches.extracted … 取り込み原本の抽出結果（後から照合するため）
--
-- 「未確定」を正常扱いしないことがこの表の目的なので、必要人数は NOT NULL にしない。
-- 行が無い=未入力 / state='undecided'=人数未確定 / state='closed'=その日は動かない を区別する。
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) 共有の必要人数（配置と独立）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_staffing_requirements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shift_date   date NOT NULL,
  course_id    uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  -- 便を使わないコースは 0（shifts / driver_courses と同じ約束）
  cycle_no     int  NOT NULL DEFAULT 0,
  -- working=動く（必要人数まで決まっている） / closed=その日は動かない / undecided=人数がまだ決まっていない
  state        text NOT NULL,
  required_count int,
  note         text NOT NULL DEFAULT '',
  updated_by   uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, shift_date, course_id, cycle_no),
  CONSTRAINT shift_staffing_requirements_state_check
    CHECK (state IN ('working', 'closed', 'undecided')),
  -- 人数は「動く」ときだけ持つ。未確定・休みに人数を残さない
  CONSTRAINT shift_staffing_requirements_count_check CHECK (
    (state = 'working' AND required_count IS NOT NULL AND required_count BETWEEN 0 AND 50)
    OR (state <> 'working' AND required_count IS NULL)
  ),
  CONSTRAINT shift_staffing_requirements_cycle_check CHECK (cycle_no >= 0),
  CONSTRAINT shift_staffing_requirements_note_check CHECK (char_length(note) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_shift_staffing_requirements_org_date
  ON public.shift_staffing_requirements (org_id, shift_date);

COMMENT ON TABLE public.shift_staffing_requirements IS
  '日×コース×便の必要人数。誰を置いたかとは別に管理し、配置が全部抜けた日でも不足を検知するための基準';
COMMENT ON COLUMN public.shift_staffing_requirements.state IS
  'working=動く（required_count が必要） / closed=その日は動かない / undecided=人数未確定。行が無い=未入力';
COMMENT ON COLUMN public.shift_staffing_requirements.required_count IS
  '必要人数。0 は「動くが人は要らない」。未確定は NULL（0 で埋めない）';

-- 曜日ごとの「いつもの」基準。日付の指定が無ければこれを使う。
-- 基準も日付の指定も無い枠は「未入力」であり、休みとして扱わない。
CREATE TABLE IF NOT EXISTS public.shift_staffing_baselines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  cycle_no     int  NOT NULL DEFAULT 0,
  -- 0=日曜 … 6=土曜（JS の getDay と同じ）
  weekday      int  NOT NULL,
  -- 曜日の基準に「未確定」は置かない（未確定は日付の指定で表す）
  state        text NOT NULL,
  required_count int,
  updated_by   uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, course_id, cycle_no, weekday),
  CONSTRAINT shift_staffing_baselines_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT shift_staffing_baselines_state_check CHECK (state IN ('working', 'closed')),
  CONSTRAINT shift_staffing_baselines_count_check CHECK (
    (state = 'working' AND required_count IS NOT NULL AND required_count BETWEEN 0 AND 50)
    OR (state = 'closed' AND required_count IS NULL)
  ),
  CONSTRAINT shift_staffing_baselines_cycle_check CHECK (cycle_no >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shift_staffing_baselines_org
  ON public.shift_staffing_baselines (org_id, course_id);

COMMENT ON TABLE public.shift_staffing_baselines IS
  '曜日ごとの必要人数の基準。個人メモ盤の「担当枠の稼働曜日・必要人数」を会社の共有設定として持つ';

-- ------------------------------------------------------------
-- 2) 本人の予定確認（通知の既読とは別）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_plan_confirmations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  driver_id    uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  shift_date   date NOT NULL,
  -- 確認した時点の「その人のその日の予定」の版。今の版と違えば未確認に戻る
  plan_version text NOT NULL,
  -- confirmed=その予定で行ける / unavailable=対応できない
  response     text NOT NULL,
  note         text NOT NULL DEFAULT '',
  responded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, driver_id, shift_date),
  CONSTRAINT shift_plan_confirmations_response_check CHECK (response IN ('confirmed', 'unavailable')),
  CONSTRAINT shift_plan_confirmations_version_check CHECK (char_length(plan_version) BETWEEN 1 AND 64),
  CONSTRAINT shift_plan_confirmations_note_check CHECK (char_length(note) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_shift_plan_confirmations_org_date
  ON public.shift_plan_confirmations (org_id, shift_date);

COMMENT ON TABLE public.shift_plan_confirmations IS
  '本人が予定を確認したかどうか。通知の既読（notifications.read_at）とは別の事実で、版が変われば無効になる';
COMMENT ON COLUMN public.shift_plan_confirmations.plan_version IS
  '確認した時点の予定の版。集合時刻など重要項目が変わると別の版になり、再確認が必要になる';

-- 確認は上書きされるので、いつ何に対して答えたかは追記で残す（確認後に変えた場合の追跡用）
CREATE TABLE IF NOT EXISTS public.shift_plan_confirmation_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  driver_id    uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  shift_date   date NOT NULL,
  plan_version text NOT NULL,
  response     text NOT NULL,
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_plan_confirmation_logs_org_date
  ON public.shift_plan_confirmation_logs (org_id, shift_date, created_at DESC);

-- ------------------------------------------------------------
-- 3) 取り込み原本の抽出結果（原本照合の材料）
-- ------------------------------------------------------------
ALTER TABLE public.shift_import_batches
  ADD COLUMN IF NOT EXISTS extracted jsonb,
  -- 抽出結果が覆う期間。照合のときに対象期間と重なるバッチだけを読む
  ADD COLUMN IF NOT EXISTS covers_start date,
  ADD COLUMN IF NOT EXISTS covers_end   date;

CREATE INDEX IF NOT EXISTS idx_shift_import_batches_covers
  ON public.shift_import_batches (org_id, covers_end DESC)
  WHERE extracted IS NOT NULL AND reverted_at IS NULL;

COMMENT ON COLUMN public.shift_import_batches.extracted IS
  '取り込み時にAIが読み取った内容そのもの。後から「原本の通りに入っているか」を照合するために残す。'
  '同じ誤読は同じまま通るので、原本との独立した確認を置き換えるものではない';

-- 認証ロールへ直接の権限は渡さない（159 と同じ方針。アクセスはサーバー経由のみ）
REVOKE ALL ON public.shift_staffing_requirements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shift_staffing_baselines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shift_plan_confirmations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shift_plan_confirmation_logs FROM PUBLIC, anon, authenticated;

COMMIT;
