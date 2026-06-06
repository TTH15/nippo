-- ============================================================
-- 送信後画面のイベント連動を柔軟化する拡張。
--   ranking_source: ランキングの表示ソースを手動で制御
--     'auto'       … 期間内の active イベントを自動検出（あればチーム順位／なければ個人）※従来挙動
--     'event'      … linked_event_id のイベントを期間に関係なく使用（明示選択）
--     'individual' … 常に個人ランキング
--     'none'       … ランキング非表示
--   linked_event_id: 'event' モードで使うイベント
--   thanks_title / thanks_message: 送信後に出す文言（例「お疲れさまでした」）
-- events.team_ranking_visible_to_drivers: イベント毎にドライバーへ順位を公開するか
-- ============================================================

ALTER TABLE submit_screen_config
  ADD COLUMN IF NOT EXISTS ranking_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS linked_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thanks_title text NOT NULL DEFAULT 'お疲れさまでした',
  ADD COLUMN IF NOT EXISTS thanks_message text NOT NULL DEFAULT '';

ALTER TABLE submit_screen_config
  DROP CONSTRAINT IF EXISTS submit_screen_config_ranking_source_chk;

ALTER TABLE submit_screen_config
  ADD CONSTRAINT submit_screen_config_ranking_source_chk CHECK (
    ranking_source IN ('auto', 'event', 'individual', 'none')
  );

-- 既存行は show_ranking を ranking_source に反映（false→none, true→auto）
UPDATE submit_screen_config
   SET ranking_source = CASE WHEN show_ranking = false THEN 'none' ELSE 'auto' END
 WHERE ranking_source = 'auto';

-- イベント毎の表示設定（順位公開）。既定は非公開（=従来の安全側）。
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS team_ranking_visible_to_drivers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN submit_screen_config.ranking_source IS '送信後ランキングの表示ソース: auto|event|individual|none';
COMMENT ON COLUMN submit_screen_config.linked_event_id IS 'ranking_source=event のとき使用するイベント';
COMMENT ON COLUMN submit_screen_config.thanks_title IS '送信後画面の見出し文言（例: お疲れさまでした）';
COMMENT ON COLUMN submit_screen_config.thanks_message IS '送信後画面の補足文言';
COMMENT ON COLUMN events.team_ranking_visible_to_drivers IS 'このイベントでドライバーにチーム順位を公開するか';
