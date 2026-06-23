-- ============================================================
-- 本登録（KYC）の免許証・顔写真用 Storage バケット（非公開）。
--   サーバは service-role クライアントで upload / createSignedUrl するため
--   バケットは非公開(public=false)。閲覧は署名URL経由（承認後に org へ開示）。
--   ※ 環境により storage スキーマへの INSERT 権限が必要。失敗時は
--     Supabase ダッシュボードで同名バケットを手動作成して代替可。
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', false)
ON CONFLICT (id) DO NOTHING;
