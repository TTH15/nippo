-- ============================================================
-- 送信フォームの注意バナー設定。
--   ドライバーが日報を記入する送信フォーム(SubmitPageClientV2)の上部に表示する
--   運営からの注意/連絡メッセージ。期間指定で表示する。
--   form_notice_enabled … バナー機能の ON/OFF
--   form_notice_message … 表示する本文
--   form_notice_start   … 表示開始日（NULL=下限なし）
--   form_notice_end     … 表示終了日（NULL=上限なし、当日を含む）
--   単一行運用の submit_screen_config に追加（select * 読み取りなので欠落時は既定で無効）。
-- ============================================================

ALTER TABLE submit_screen_config
  ADD COLUMN IF NOT EXISTS form_notice_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS form_notice_message text   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS form_notice_start   date,
  ADD COLUMN IF NOT EXISTS form_notice_end     date;

COMMENT ON COLUMN submit_screen_config.form_notice_enabled IS '送信フォーム注意バナーの表示ON/OFF';
COMMENT ON COLUMN submit_screen_config.form_notice_message IS '送信フォーム上部に表示する注意メッセージ本文';
COMMENT ON COLUMN submit_screen_config.form_notice_start IS '表示開始日（NULL=下限なし）';
COMMENT ON COLUMN submit_screen_config.form_notice_end IS '表示終了日（NULL=上限なし、当日を含む）';
