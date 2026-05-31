-- ============================================================
-- ドライバーの「日報送信後画面」の設定（運営が設計）。
--   今日の報酬見込み＋ランキング（チーム戦未開催時の個人ランキング）を制御。
--   単一行運用（id 固定）。metric_fields は採点と同じ {unitId, fieldKey}[] 形。
-- ============================================================

CREATE TABLE IF NOT EXISTS submit_screen_config (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ランキング指標（報告項目の合計）。例: 完了個数系
  metric_label      text        NOT NULL DEFAULT '完了個数',
  metric_fields     jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{unitId, fieldKey}]
  -- 個人ランキングの対象ドライバー（空=全ドライバー）
  target_driver_ids jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  -- 集計期間（v1 は 'current_month' 固定。将来拡張）
  period            text        NOT NULL DEFAULT 'current_month',
  -- 送信後にランキングを表示するか
  show_ranking      boolean     NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
