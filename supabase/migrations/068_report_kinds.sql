-- ============================================================
-- 諸報告の「報告種別」を設定化（ハードコード解消）。
--   report_kinds: 運営が種別を追加/編集/並替/有効化できるマスタ。
--     使用フィールド … uses_location / uses_odometer / uses_description / uses_amount
--     capability    … 承認時の特別な振る舞い
--       'none'        … なし
--       'oil_mileage' … 承認時に車両の前回オイル交換距離を更新（uses_odometer 前提）
--       'expense'     … 承認時に臨時経費へ連携しペイメント算入（uses_amount 前提）
--   oil_change_reports の種別結合 CHECK は撤去し、カスタム種別を許可する。
-- ============================================================

CREATE TABLE IF NOT EXISTS report_kinds (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  text        NOT NULL UNIQUE,
  label                text        NOT NULL,
  sort_order           int         NOT NULL DEFAULT 0,
  is_active            boolean     NOT NULL DEFAULT true,
  uses_location        boolean     NOT NULL DEFAULT true,
  uses_odometer        boolean     NOT NULL DEFAULT false,
  uses_description     boolean     NOT NULL DEFAULT true,
  uses_amount          boolean     NOT NULL DEFAULT false,
  description_required boolean     NOT NULL DEFAULT true,
  description_label    text,
  capability           text        NOT NULL DEFAULT 'none'
                                   CHECK (capability IN ('none', 'oil_mileage', 'expense')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_kinds_active_sort ON report_kinds (is_active, sort_order);

-- 既定の4種をシード（現行挙動を踏襲）。
INSERT INTO report_kinds (key, label, sort_order, uses_location, uses_odometer, uses_description, uses_amount, description_required, capability)
VALUES
  ('oil_change', 'オイル交換', 1, true, true,  false, false, false, 'oil_mileage'),
  ('repair',     '修理',       2, true, false, true,  false, true,  'none'),
  ('expense',    '経費報告',   3, true, false, true,  true,  true,  'expense'),
  ('other',      'その他',     4, true, false, true,  false, true,  'none')
ON CONFLICT (key) DO NOTHING;

-- oil_change_reports: 種別に結合した CHECK 制約を撤去（カスタム種別を許可）。
-- 値のみの制約（odometer >= 0）は残す。
ALTER TABLE oil_change_reports DROP CONSTRAINT IF EXISTS oil_change_reports_kind_allowed;
ALTER TABLE oil_change_reports DROP CONSTRAINT IF EXISTS oil_change_reports_oil_fields;
ALTER TABLE oil_change_reports DROP CONSTRAINT IF EXISTS oil_change_reports_misc_fields;
ALTER TABLE oil_change_reports DROP CONSTRAINT IF EXISTS oil_change_reports_expense_fields;

COMMENT ON TABLE report_kinds IS '諸報告の種別マスタ（運営が設定）。使用フィールドと承認時の能力を定義。';
COMMENT ON COLUMN report_kinds.capability IS 'none|oil_mileage|expense（承認時の特別な振る舞い）';
