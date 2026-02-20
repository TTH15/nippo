-- ドライバー表示名（シフト等で表示。未設定時は苗字のみ表示）
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS display_name text;

COMMENT ON COLUMN drivers.display_name IS '表示名。未設定時は名前の先頭2文字（苗字）で表示';
