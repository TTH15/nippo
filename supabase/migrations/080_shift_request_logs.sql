-- ============================================================
-- 希望休の変更履歴（監査ログ）。追記専用。
--   ドライバー提出・運営削除のたびに「誰が・いつ・どの日/便を・追加/削除したか」を記録する。
--   shift_requests は「現在の状態」、本テーブルは「変更の履歴」を保持（分離）。
--   初回提出 = その(driver,date,slot)の最古の 'add'。最終変更 = 最新イベント。
-- ============================================================
CREATE TABLE IF NOT EXISTS shift_request_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  request_date date        NOT NULL,
  -- 便。NULL=全休。便マスタが将来削除されても履歴を残すため FK は張らず、便名はスナップショット保存。
  slot_id      uuid,
  slot_name    text,                   -- 便名スナップショット（全休は NULL）
  action       text        NOT NULL CHECK (action IN ('add', 'remove')),
  actor_type   text        NOT NULL CHECK (actor_type IN ('driver', 'admin')),
  actor_id     uuid,                   -- 操作者の drivers.id（driver/admin とも）
  actor_name   text,                   -- 操作者表示名スナップショット
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_request_logs_driver_date
  ON shift_request_logs (driver_id, request_date);
CREATE INDEX IF NOT EXISTS idx_shift_request_logs_created
  ON shift_request_logs (created_at);

COMMENT ON TABLE shift_request_logs IS '希望休の変更履歴（追記専用・監査用）。誰がいつ何を add/remove したか。';
COMMENT ON COLUMN shift_request_logs.slot_id IS '便。NULL=全休。';
COMMENT ON COLUMN shift_request_logs.slot_name IS '便名スナップショット（便マスタ削除後も履歴可読に）。';
COMMENT ON COLUMN shift_request_logs.action IS 'add=希望休を追加 / remove=希望休を解除。';
COMMENT ON COLUMN shift_request_logs.actor_type IS 'driver=本人提出 / admin=運営操作。';
