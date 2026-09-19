-- ============================================================
-- 配信ログの制約をリポジトリと本番で合わせる（2026-09-18）。
-- 設計: docs/design/operational-risk-detection-2026-09.md O-2
--
-- 108 の CHECK は channel IN ('line','push') だが、**本番では 'web_push' が追加済み**
-- （アプリは 'web_push' で書いている）。リポジトリの migration だけが古く、
-- 新しい環境に 001〜を流すと配信ログの保存だけが静かに失敗する状態だった。
-- ここで本番に合わせる。
--
-- あわせて、届かなかった理由を残せるようにする。status='skipped' の error に
--   unlinked        … LINE 未連携（経路が無い）
--   not_configured  … その会社でそのチャネルが未設定
--   no_subscription … Web Push の端末が1台も無い
-- を入れる運用にする（列は追加しない。既存の error をそのまま使う）。
-- ============================================================
BEGIN;

ALTER TABLE public.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE public.notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('line', 'push', 'web_push'));

COMMENT ON COLUMN public.notification_deliveries.status IS
  'sent=そのチャネルで送れた / failed=送ろうとして失敗 / skipped=経路が無い（error に理由）';
COMMENT ON COLUMN public.notification_deliveries.error IS
  '失敗の内容、または skipped の理由（unlinked / not_configured / no_subscription）';

COMMIT;
