-- ============================================================
-- E — LINE 連携＋通知インボックス（roadmap-2026-07 E②③）
-- 設計の正本: docs/notification-flow.md
--   §1-2 アプリ内インボックスが source of truth、LINE/push は配信チャネル
--   §1-1 LINE 連携は identity 単位（統合公式1本）。org 別 line_links は
--        BYO-LINE の実需が出てから昇格させる（今は作らない）
--   §3   冪等性は「org×日×種別×membership」キー = notifications.dedupe_key
-- 追加のみ・既存挙動不変。
-- ============================================================

-- ------------------------------------------------------------
-- 1) LINE 連携状態（identity 単位）
--    line_user_id は 088 で確保済み（UNIQUE）。ここでは連携・ブロックの
--    状態列だけを足す。unfollow は削除ではなく blocked_at で記録する
--    （再フォローで復活させるため。userId は同一人物なら不変）。
-- ------------------------------------------------------------
ALTER TABLE identities ADD COLUMN IF NOT EXISTS line_linked_at  timestamptz;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS line_blocked_at timestamptz;

-- ------------------------------------------------------------
-- 2) ワンタイム連携コード
--    アプリ側で発行 → 本人が LINE トークに送信 → webhook が突合して
--    identities.line_user_id を確定する。短命・1回限り。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_link_codes (
  code        text        PRIMARY KEY,              -- 表示用の短いコード（衝突時は再発行）
  identity_id uuid        NOT NULL REFERENCES identities(id),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_link_codes_identity ON line_link_codes (identity_id);

-- ------------------------------------------------------------
-- 3) 通知インボックス（真実）
--    受信者ごとに1行。org_id を必ず保持し、LINE 送信はこの行から導出する
--    （notification-flow §1-3 の誤爆防止レイヤ4）。
--    org_id NULL = プラットフォーム告知レーン（§1-4）。
--    driver_id = membership（org 文脈）。identity_id = 配信先の解決に使う。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        REFERENCES organizations(id), -- NULL = プラットフォーム告知
  driver_id   uuid        REFERENCES drivers(id),   -- membership（org 文脈での受信者）
  identity_id uuid        NOT NULL REFERENCES identities(id),
  kind        text        NOT NULL,                 -- assignment / assignment_changed / broadcast ...
  title       text        NOT NULL,
  body        text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key  text        UNIQUE,                   -- 例: {org}:{date}:{kind}:{driver}。NULL = 重複抑止なし
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_identity_created
  ON notifications (identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_org_created
  ON notifications (org_id, created_at DESC);
-- 未読バッジ用（未読行だけの部分インデックス）
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (identity_id) WHERE read_at IS NULL;

-- ------------------------------------------------------------
-- 4) 配信ログ（チャネル別・1通知 = 0..n 配信）
--    notification-flow §8「送信失敗はリトライ＋ログに失敗記録」。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid        NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text        NOT NULL,             -- line / push
  status          text        NOT NULL,             -- sent / failed / skipped
  error           text,
  sent_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('line', 'push'));
ALTER TABLE notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_status_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_status_check
  CHECK (status IN ('sent', 'failed', 'skipped'));
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification
  ON notification_deliveries (notification_id);

-- ------------------------------------------------------------
-- 5) 一斉配信 capability
--    コード側の正本は server/auth/capabilities.ts。
--    既存挙動維持のため can_manage_members 保持ロールへ付与（運営連絡の担い手）。
-- ------------------------------------------------------------
INSERT INTO role_capabilities (role_id, capability)
SELECT rc.role_id, 'can_send_notifications'
FROM role_capabilities rc
WHERE rc.capability = 'can_manage_members'
ON CONFLICT (role_id, capability) DO NOTHING;
