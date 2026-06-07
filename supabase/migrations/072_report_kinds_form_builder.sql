-- ============================================================
-- 諸報告のフォームビルダー化（基盤）。
--   report_kinds.fields: 種別ごとの可変フィールド定義（順序付き配列・jsonb）。
--     各要素: { id, type, label, required, placeholder?, maxLen?, min?, max?,
--               options?:[{value,label}], role?:'none'|'odometer'|'amount',
--               maxFileBytes?, acceptMime? }
--     type: short_text|long_text|number|select|multiselect|date|time|bool|file
--   report_kinds.vehicle_mode: 車両選択の扱い required|optional|none。
--   oil_change_reports.answers: 可変回答 { [fieldId]: value }。
--   oil_change_reports.attachments: 添付参照 [{ fieldId, path, name, mime, size }]。
--   既存の uses_*/description_label/capability は後方互換のため残置。
--   既存各行の fields/vehicle_mode を旧フラグから自動生成する。
-- ============================================================

ALTER TABLE report_kinds
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS vehicle_mode text NOT NULL DEFAULT 'required';

ALTER TABLE report_kinds
  DROP CONSTRAINT IF EXISTS report_kinds_vehicle_mode_chk;
ALTER TABLE report_kinds
  ADD CONSTRAINT report_kinds_vehicle_mode_chk CHECK (vehicle_mode IN ('required', 'optional', 'none'));

ALTER TABLE oil_change_reports
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 既存種別の fields / vehicle_mode を旧フラグから生成（fields 未設定の行のみ）。
-- 固定ID（f_location/f_odometer/f_description/f_amount）を付与し、既存レポートの
-- 固定カラム fallback と対応させる。
UPDATE report_kinds SET
  vehicle_mode = CASE WHEN uses_vehicle THEN 'required' ELSE 'none' END,
  fields =
    (CASE WHEN uses_location THEN jsonb_build_array(jsonb_build_object(
        'id', 'f_location', 'type', 'short_text', 'label', '場所', 'required', true
      )) ELSE '[]'::jsonb END)
    || (CASE WHEN uses_odometer THEN jsonb_build_array(jsonb_build_object(
        'id', 'f_odometer', 'type', 'number', 'label', '走行距離 (km)', 'required', true,
        'min', 0, 'role', CASE WHEN capability = 'oil_mileage' THEN 'odometer' ELSE 'none' END
      )) ELSE '[]'::jsonb END)
    || (CASE WHEN uses_description THEN jsonb_build_array(jsonb_build_object(
        'id', 'f_description', 'type', 'long_text',
        'label', COALESCE(NULLIF(description_label, ''), '内容'), 'required', description_required
      )) ELSE '[]'::jsonb END)
    || (CASE WHEN uses_amount THEN jsonb_build_array(jsonb_build_object(
        'id', 'f_amount', 'type', 'number', 'label', '金額', 'required', true,
        'min', 1, 'role', CASE WHEN capability = 'expense' THEN 'amount' ELSE 'none' END
      )) ELSE '[]'::jsonb END)
WHERE fields = '[]'::jsonb;

COMMENT ON COLUMN report_kinds.fields IS '可変フィールド定義の配列（フォームビルダー）';
COMMENT ON COLUMN report_kinds.vehicle_mode IS '車両選択: required|optional|none';
COMMENT ON COLUMN oil_change_reports.answers IS '可変回答 { fieldId: value }';
COMMENT ON COLUMN oil_change_reports.attachments IS '添付参照 [{ fieldId, path, name, mime, size }]';
