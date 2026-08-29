-- 日報の入力項目を「コース（＋便）ごと」に選べるようにする。
--
-- 背景: 報告項目はキャリア配下の unit に付く（例: Amazon配送 = 午前/午後/4便 の6項目）。
-- ところが実際に使う項目はコースによって違う。
--   上鳥羽・豊中  … サイクル C1=午前 / C2=午後。4便は使わない
--   Amazon昼・上賀茂 … サイクル無しで午前+午後を1本に入力。4便は使わない
--   ミッドナイト   … 4便のみ
-- 全項目を出すと、使わない欄が常に0で並び、特にサイクル利用コースでは
-- C1の日報にもC2の日報にも午前・午後・4便が全部出て重複して見える（2026-08-28 実地報告）。
--
-- 行が1件も無いコース/便は「全項目を使う」とみなす（後方互換）。
CREATE TABLE IF NOT EXISTS course_report_fields (
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  -- 0 = コース共通（サイクルを使わない、または便ごとに分けない）
  cycle_no   int  NOT NULL DEFAULT 0,
  unit_id    uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  field_key  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, cycle_no, unit_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_course_report_fields_lookup
  ON course_report_fields (course_id, cycle_no);

COMMENT ON TABLE course_report_fields IS
  'コース（＋便）ごとに日報で入力・表示する項目。行が無いコース/便は全項目を使う';
COMMENT ON COLUMN course_report_fields.cycle_no IS
  '0 = コース共通。1以上 = その便だけで使う項目';
