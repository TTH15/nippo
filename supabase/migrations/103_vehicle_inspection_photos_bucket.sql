-- ============================================================
-- 車両点検写真（前後左右4方向）用 Storage バケット（非公開）。
--   稼働前(pre)/後(post) の車両点検写真を保存する（vehicle_inspection_photos、migration 095）。
--   サーバは service-role で upload / createSignedUrl。閲覧は署名URL（運営の点検照合用）。
--   雛形: 098_meter_photos_bucket.sql
--   ※ 環境により storage スキーマへの INSERT 権限が必要。失敗時は
--     Supabase ダッシュボードで同名バケットを手動作成して代替可（089/098 と同様）。
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-inspection-photos', 'vehicle-inspection-photos', false)
ON CONFLICT (id) DO NOTHING;
