-- ============================================================
-- 送信後画面を「ブロックの並び」で構成できるようにする（GUIビルダー用）。
--   blocks: 表示ブロックの順序付き配列（jsonb）。null のときは従来のフラット設定から既定ブロックを導出。
--   ブロック種別:
--     greeting        … 見出し＋メッセージ
--     today_reward    … 今日の報酬見込み
--     event_points    … 開催中/指定イベントの自チーム累計ポイント（＋任意でチーム順位表）
--     personal_count  … 本人の今月の個数合計（単体表示・順位なし）
--     personal_ranking… 個人ランキング表
--   個人系ブロックは metricFields / carrierIds / targetDriverIds で集計対象を絞れる。
-- ============================================================

ALTER TABLE submit_screen_config
  ADD COLUMN IF NOT EXISTS blocks jsonb;

COMMENT ON COLUMN submit_screen_config.blocks IS '送信後画面の表示ブロック配列（null=従来フラット設定から導出）';
