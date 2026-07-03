-- ドライバーの稼働開始月/終了月（'YYYY-MM'形式、終了月はnull=現在も稼働中）。
-- 過去の請求書一覧で「その時点で在籍していたドライバー」を判定するために使う
-- （status='active'は「現在」の状態のみを表し、過去のスコープ判定には使えないため）。
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS active_from_month text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS active_until_month text;

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_active_from_month_format;
ALTER TABLE drivers ADD CONSTRAINT drivers_active_from_month_format
  CHECK (active_from_month IS NULL OR active_from_month ~ '^\d{4}-\d{2}$');

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_active_until_month_format;
ALTER TABLE drivers ADD CONSTRAINT drivers_active_until_month_format
  CHECK (active_until_month IS NULL OR active_until_month ~ '^\d{4}-\d{2}$');
