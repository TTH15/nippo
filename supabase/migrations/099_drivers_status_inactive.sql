-- drivers.status に 'inactive'（退職済み・記録保持用）を追加。
-- 過去のドライバー（現在は稼働していないが、過去請求書等の記録上は残す必要がある）を
-- 削除せず status='inactive' として区別できるようにする。

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_status_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_status_check
  CHECK (status IN ('pending', 'active', 'rejected', 'inactive'));
