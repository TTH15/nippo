-- ============================================================
-- チーム戦 / イベントの土台（スキーマのみ。UI・採点ロジックは後続）
--   運営がイベント(期間・採点ルール)とチームを設計し、累計ポイントを競う。
--   scoring_rule は柔軟に持たせるため jsonb（例: 完了個数×1pt 等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  description  text        NOT NULL DEFAULT '',
  starts_on    date,
  ends_on      date,
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  scoring_rule jsonb       NOT NULL DEFAULT '{}'::jsonb, -- 採点ルール（運営が設計）
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_teams (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#3b82f6',
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_teams_event ON event_teams (event_id);

CREATE TABLE IF NOT EXISTS event_team_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id     uuid        NOT NULL REFERENCES event_teams(id) ON DELETE CASCADE,
  driver_id   uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, driver_id) -- 1イベント内で1ドライバーは1チーム
);
CREATE INDEX IF NOT EXISTS idx_event_team_members_team ON event_team_members (team_id);

-- ポイント記録（集計由来の自動ポイント or 運営の手動加点。採点キャッシュ兼ログ）
CREATE TABLE IF NOT EXISTS event_point_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id     uuid        REFERENCES event_teams(id) ON DELETE SET NULL,
  driver_id   uuid        REFERENCES drivers(id) ON DELETE SET NULL,
  entry_date  date,
  points      numeric     NOT NULL DEFAULT 0,
  reason      text,
  source      text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_point_entries_event ON event_point_entries (event_id);
