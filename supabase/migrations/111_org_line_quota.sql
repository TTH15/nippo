-- ============================================================
-- E — org 別 LINE 通数上限の土台（roadmap-2026-07 E④）
-- 方針: 複数 org 運用時は LINE 公式 API の実値（チャネル全体で1本）ではなく、
--       プラットフォーム側が org ごとに月上限を持ち、実送信数を自前で数える。
--       （SaaS の通知枠課金＝notification-flow §9 と整合。実 API 値は
--         プラットフォーム全体が LINE 契約枠を超えていないかの監視に別途使う。）
--
-- 今回は土台のみ: 上限列を1つ足す。送信数の集計は notification_deliveries
-- （channel='line'/'web_push' の sent）から算出できるため、テーブル追加は不要。
-- 実際の送信ブロック（上限超で送らない）は複数 org が現実になる段階で実装する。
--
-- NULL = 上限なし（現行の単一 org 運用はこれ＝挙動不変）。
-- ============================================================

ALTER TABLE org_notification_settings
  ADD COLUMN IF NOT EXISTS line_monthly_limit integer;

COMMENT ON COLUMN org_notification_settings.line_monthly_limit IS
  'org ごとの月間 LINE 送信上限（通）。NULL=上限なし。実消費は notification_deliveries から集計';
