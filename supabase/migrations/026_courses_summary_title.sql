-- コースに「集計での表示タイトル」を追加（キャリア=Amazon 時など、売上集計タブで表示する見出し）
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS summary_title text;

COMMENT ON COLUMN courses.summary_title IS '売上集計タブで表示するタイトル（例: Amazon 昼）。キャリアがAmazonの場合に設定可能。';
