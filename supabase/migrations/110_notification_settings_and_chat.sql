-- ============================================================
-- E — 自動配信設定 ＋ LINE チャット（roadmap-2026-07 E④の拡張）
-- 設計: docs/notification-flow.md §3（送信トリガー3モード）／§5（org単位CMS）
--
-- 1) org_notification_settings: 通知種別ごとの ON/OFF と送信時刻（org 可変）
-- 2) line_chat_messages: 連携済みドライバーとの1対1チャット履歴
--
-- 追加のみ・既存挙動不変。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 自動配信の設定（org ごとに1行）
--    設計 §5「org設定: 含める項目トグル、通知種別ON/OFF、送信時刻」。
--    既定は全て OFF＝入れただけでは何も自動送信されない（事故防止）。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_notification_settings (
  org_id                 uuid        PRIMARY KEY REFERENCES organizations(id),

  -- 翌日アサイン通知（§2 の最優先項目）
  assignment_enabled     boolean     NOT NULL DEFAULT false,
  assignment_send_at     time        NOT NULL DEFAULT '20:00',  -- JST。cron はこの時刻で送る
  assignment_include_meeting  boolean NOT NULL DEFAULT true,    -- 集合場所・集合時刻を載せるか
  assignment_include_vehicle  boolean NOT NULL DEFAULT true,    -- 車両ナンバーを載せるか

  -- 休み通知（翌日アサインが無い人にも送るか）。§10-2 の既定は「出さない」
  rest_day_enabled       boolean     NOT NULL DEFAULT false,

  -- 変更通知（確定後にアサイン・車両が変わったら【変更】を送る）
  change_enabled         boolean     NOT NULL DEFAULT false,

  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid        REFERENCES drivers(id)
);

-- ------------------------------------------------------------
-- 2) LINE チャット履歴（連携済みドライバーとの1対1）
--    inbound  = ドライバー → 運営（webhook で受信）
--    outbound = 運営 → ドライバー（push で送信）
--    ※ LINE 公式アカウントマネージャーのチャット機能とは別に、
--      アプリ内で完結させて org スコープ・権限管理下に置く。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_chat_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id),
  driver_id       uuid        NOT NULL REFERENCES drivers(id),
  identity_id     uuid        NOT NULL REFERENCES identities(id),
  direction       text        NOT NULL,
  text            text        NOT NULL,
  -- LINE 側のメッセージID。webhook の再送で二重保存しないための冪等キー
  line_message_id text        UNIQUE,
  sent_by         uuid        REFERENCES drivers(id),   -- outbound の送信者（運営）
  read_at         timestamptz,                           -- inbound を運営が読んだ時刻
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE line_chat_messages DROP CONSTRAINT IF EXISTS line_chat_messages_direction_check;
ALTER TABLE line_chat_messages ADD CONSTRAINT line_chat_messages_direction_check
  CHECK (direction IN ('inbound', 'outbound'));

CREATE INDEX IF NOT EXISTS idx_line_chat_messages_thread
  ON line_chat_messages (org_id, driver_id, created_at DESC);
-- 未読バッジ用（運営が未読の受信メッセージだけ）
CREATE INDEX IF NOT EXISTS idx_line_chat_messages_unread
  ON line_chat_messages (org_id) WHERE direction = 'inbound' AND read_at IS NULL;
