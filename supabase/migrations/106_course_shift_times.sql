-- ============================================================
-- A2 — コース/シフトの時間モデル（roadmap-2026-07 A2）
-- コースに標準の時間・場所を持たせる（コースごとに一定という運用合意。
-- 曜日別パターンは持たない。日別の例外はシフト行の上書きで表現する）。
--   実効値 = shifts.<列> が NULL なら courses.<列>（両方 NULL = 未設定）
-- シフト表・ドライバー画面・（将来の）ハコ虎AIの時間認識の土台。追加のみ・冪等。
-- ============================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS meeting_place text NULL,
  ADD COLUMN IF NOT EXISTS meeting_time  time NULL,
  ADD COLUMN IF NOT EXISTS arrival_time  time NULL,
  ADD COLUMN IF NOT EXISTS end_time      time NULL;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS meeting_place text NULL,
  ADD COLUMN IF NOT EXISTS meeting_time  time NULL,
  ADD COLUMN IF NOT EXISTS arrival_time  time NULL,
  ADD COLUMN IF NOT EXISTS end_time      time NULL;

COMMENT ON COLUMN courses.meeting_place IS '標準の集合場所（自由入力）';
COMMENT ON COLUMN courses.meeting_time  IS '標準の集合時刻';
COMMENT ON COLUMN courses.arrival_time  IS '標準の着車時刻';
COMMENT ON COLUMN courses.end_time      IS '標準の終業時刻';
COMMENT ON COLUMN shifts.meeting_place  IS '集合場所の個別上書き（NULL=コース標準）';
COMMENT ON COLUMN shifts.meeting_time   IS '集合時刻の個別上書き（NULL=コース標準）';
COMMENT ON COLUMN shifts.arrival_time   IS '着車時刻の個別上書き（NULL=コース標準）';
COMMENT ON COLUMN shifts.end_time       IS '終業時刻の個別上書き（NULL=コース標準）';
