-- ============================================================
-- 報告種別ごとに「車両を選択させるか」を設定可能にする。
--   uses_vehicle: true=実施車両の選択を表示・必須 / false=非表示。
--   既定は true（現行挙動＝全種別で車両必須 を踏襲）。
--   capability='oil_mileage'（車両距離更新）は車両が前提のため true 推奨。
-- ============================================================

ALTER TABLE report_kinds
  ADD COLUMN IF NOT EXISTS uses_vehicle boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN report_kinds.uses_vehicle IS 'ドライバーの諸報告で実施車両の選択を表示・必須にするか';
