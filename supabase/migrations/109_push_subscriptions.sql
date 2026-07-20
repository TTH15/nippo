-- ============================================================
-- E — Web Push 購読（roadmap-2026-07 E⑦）
-- LINE 未連携者にも「気づける」経路を用意する。インボックス（108）を
-- 真実としたまま、配信チャネルを1本増やすだけの追加。
--
-- 購読は端末ごと（1人が複数端末を持ちうる）。identity 単位で束ねる。
-- endpoint がブラウザ側の一意キーなので PK にする（同一端末の再購読は upsert）。
-- ※ iOS はホーム画面追加した PWA のみ購読できる（Apple の制約）。
--   届かない端末があること自体は想定内で、その受け皿がインボックス。
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    text        PRIMARY KEY,
  identity_id uuid        NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  p256dh      text        NOT NULL,   -- 購読ごとの公開鍵（暗号化に使う）
  auth        text        NOT NULL,   -- 購読ごとの認証シークレット
  user_agent  text,                    -- 「どの端末の購読か」を運営・本人が識別するため
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_identity ON push_subscriptions (identity_id);

-- 配信ログのチャネルに web_push を追加（108 の CHECK を張り替える）
ALTER TABLE notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('line', 'push', 'web_push'));
