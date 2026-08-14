-- ============================================================
-- LINE チャットのスレッド一覧（最終メッセージ+未読数）を DB 側で集計する関数。
--
-- 従来はアプリ側が org の直近500件を固定 limit で転送して JS で畳んでおり、
-- 500件を超えると古いスレッドの最終メッセージが消え、未読数が過小になる
-- バグでもあった（2026-08 通信監査）。
--
-- ★アプリ側 /api/admin/notifications/chats は RPC 優先+未適用環境では
--   従来の500件スキャンへフォールバックする。
-- ============================================================

CREATE OR REPLACE FUNCTION chat_thread_summaries(p_org uuid)
RETURNS TABLE (
  driver_id uuid,
  last_text text,
  last_direction text,
  last_at timestamptz,
  unread_count bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH last_msg AS (
    SELECT DISTINCT ON (m.driver_id)
           m.driver_id, m.text, m.direction, m.created_at
    FROM line_chat_messages m
    WHERE m.org_id = p_org
    ORDER BY m.driver_id, m.created_at DESC
  ),
  unread AS (
    SELECT m.driver_id, count(*) AS unread_count
    FROM line_chat_messages m
    WHERE m.org_id = p_org
      AND m.direction = 'inbound'
      AND m.read_at IS NULL
    GROUP BY m.driver_id
  )
  SELECT l.driver_id, l.text, l.direction, l.created_at, COALESCE(u.unread_count, 0)
  FROM last_msg l
  LEFT JOIN unread u ON u.driver_id = l.driver_id;
$$;

COMMENT ON FUNCTION chat_thread_summaries(uuid) IS
  'チャットスレッド一覧（ドライバーごとの最終メッセージ+未読数）。管理画面の60秒ポーリング用';
