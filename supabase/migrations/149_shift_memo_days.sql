-- ============================================================
-- シフトメモ（日付単位の共有下書き）。
-- 正式シフトとは分離し、名前札と自由メモだけを保存する。
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_memo_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  memo_date date NOT NULL,
  placements jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES drivers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, memo_date),
  CONSTRAINT shift_memo_days_placements_array CHECK (jsonb_typeof(placements) = 'array'),
  CONSTRAINT shift_memo_days_note_length CHECK (char_length(note) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_shift_memo_days_org_date
  ON shift_memo_days (org_id, memo_date);

COMMENT ON TABLE shift_memo_days IS
  '正式シフトへ影響しない共有メモ。日付ごとの名前札配置と自由メモを保持する';
COMMENT ON COLUMN shift_memo_days.placements IS
  '[{id, courseId, cycleNo, driverId?, label}]。自由文字札はdriverId=null';

