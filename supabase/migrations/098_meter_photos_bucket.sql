-- ============================================================
-- オドメーター（メーター）写真用 Storage バケット（非公開）。
--   出退勤時のメーター写真を保存し「写真が真実（誤読は手修正）」の正本にする（§7）。
--   サーバは service-role で upload / createSignedUrl。閲覧は署名URL（運営の勤怠照合用）。
--   承認まで保持→承認後ティア削除のポリシーは別途 cleanup で適用予定（§7,§11）。
--   ※ 環境により storage スキーマへの INSERT 権限が必要。失敗時は
--     Supabase ダッシュボードで同名バケットを手動作成して代替可（089 と同様）。
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('meter-photos', 'meter-photos', false)
ON CONFLICT (id) DO NOTHING;
