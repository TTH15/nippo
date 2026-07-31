-- ============================================================
-- シフト表 AI 取り込み（ハコ虎AI）
-- 1) 取り込みバッチ: 1回の取り込みで登録した行をまとめて取り消せるようにする
-- 2) 対応辞書: 管理者が確定した「表記名→ドライバー」「ラベル→コース」を記憶し、
--    翌月以降は AI の推測ではなく承認済みの対応を初期値に使う
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_by uuid REFERENCES drivers(id) ON DELETE SET NULL,
  sources text[] NOT NULL DEFAULT '{}',
  registered int NOT NULL DEFAULT 0,
  reverted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_import_batches_org ON shift_import_batches (org_id, created_at DESC);

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES shift_import_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_import_batch ON shifts (import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shift_import_name_maps (
  org_id uuid NOT NULL,
  raw_name text NOT NULL,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, raw_name)
);

CREATE TABLE IF NOT EXISTS shift_import_label_maps (
  org_id uuid NOT NULL,
  raw_label text NOT NULL,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, raw_label)
);

COMMENT ON TABLE shift_import_batches IS 'シフト表 AI 取り込みの実行単位。取り消し（revert）で紐付く shifts を一括削除する';
COMMENT ON COLUMN shifts.import_batch_id IS 'AI 取り込みで作成された行の出自バッチ。手動作成行は NULL';
COMMENT ON TABLE shift_import_name_maps IS 'シフト表の表記名 → ドライバーの確定済み対応（正規化済みの表記をキーにする）';
COMMENT ON TABLE shift_import_label_maps IS 'シフト表の勤務地・便ラベル → コースの確定済み対応（正規化済みの表記をキーにする）';
