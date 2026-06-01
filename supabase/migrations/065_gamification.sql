-- ドライバーアプリのゲーミフィケーション（チーム戦）。
--   drivers.last_bonus_seen_at: 「ボーナスポイント付与」演出の既読時刻。
--     これより後の手動加点(event_point_entries source='manual', points>0) があれば
--     次回アプリ起動時に1回だけ演出を表示し、表示後に now() へ更新する。
--   submit_screen_config.team_ranking_visible_to_drivers: ドライバーにチーム順位を公開するか。
--     既定 false = 自チームのポイントのみ表示（順位・他チーム・個人MVPは非表示）。
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_bonus_seen_at timestamptz;

ALTER TABLE submit_screen_config
  ADD COLUMN IF NOT EXISTS team_ranking_visible_to_drivers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN drivers.last_bonus_seen_at IS 'ボーナス付与演出の既読時刻（これ以降の手動加点を次回起動時に1回だけ通知）';
COMMENT ON COLUMN submit_screen_config.team_ranking_visible_to_drivers IS 'ドライバーにチーム順位を公開するか（false=自チームのポイントのみ）';
