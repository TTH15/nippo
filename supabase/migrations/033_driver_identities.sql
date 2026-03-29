-- ============================================================
-- ドライバーごとに最大2つの「勤務区分」（ドライバーコード・事業所・担当コース）
-- を持てるようにする。日報は勤務区分単位で1日1件。
-- ============================================================

-- 1) 勤務区分（スロット1/2）
CREATE TABLE driver_identities (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid        NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  slot         smallint    NOT NULL CHECK (slot IN (1, 2)),
  driver_code  text        NOT NULL,
  office_code  text        NOT NULL DEFAULT '',
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, slot),
  UNIQUE (driver_code)
);

CREATE INDEX idx_driver_identities_driver ON driver_identities (driver_id);

-- 2) 既存ドライバー: スロット1として移行（drivers のコードを引き継ぎ）
INSERT INTO driver_identities (driver_id, slot, driver_code, office_code)
SELECT d.id,
       1,
       d.driver_code,
       COALESCE(NULLIF(trim(d.office_code), ''), '')
FROM drivers d
WHERE d.role = 'DRIVER'
  AND d.driver_code IS NOT NULL
  AND trim(d.driver_code) <> '';

-- daily_reports 等の参照に合わせ、スロット1が未作成のドライバーがあれば救済
INSERT INTO driver_identities (driver_id, slot, driver_code, office_code)
SELECT DISTINCT ON (d.id) d.id,
       1,
       d.driver_code,
       COALESCE(NULLIF(trim(d.office_code), ''), '')
FROM drivers d
INNER JOIN daily_reports dr ON dr.driver_id = d.id
WHERE d.role = 'DRIVER'
  AND d.driver_code IS NOT NULL
  AND trim(d.driver_code) <> ''
  AND NOT EXISTS (SELECT 1 FROM driver_identities di WHERE di.driver_id = d.id AND di.slot = 1);

-- drivers.driver_code の重複チェックは identities 側の UNIQUE に一本化するため、
-- drivers 上の UNIQUE 制約を外す（コードは identities.slot1 と同期運用）
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_driver_code_key;

-- 3) driver_courses に勤務区分を紐付け
ALTER TABLE driver_courses
  ADD COLUMN IF NOT EXISTS driver_identity_id uuid REFERENCES driver_identities(id) ON DELETE CASCADE;

UPDATE driver_courses dc
SET driver_identity_id = di.id
FROM driver_identities di
WHERE di.driver_id = dc.driver_id
  AND di.slot = 1
  AND dc.driver_identity_id IS NULL;

-- 紐付けできない行は削除（通常は存在しない想定）
DELETE FROM driver_courses WHERE driver_identity_id IS NULL;

ALTER TABLE driver_courses ALTER COLUMN driver_identity_id SET NOT NULL;

ALTER TABLE driver_courses DROP CONSTRAINT IF EXISTS driver_courses_driver_id_course_id_key;
ALTER TABLE driver_courses
  ADD CONSTRAINT driver_courses_identity_course UNIQUE (driver_identity_id, course_id);

CREATE INDEX IF NOT EXISTS idx_driver_courses_driver_identity ON driver_courses (driver_identity_id);

-- driver_id は参照用に残す（既存クエリ互換）。整合性はアプリ側で維持。

-- 4) daily_reports を勤務区分単位の一意に変更
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS driver_identity_id uuid REFERENCES driver_identities(id) ON DELETE CASCADE;

UPDATE daily_reports dr
SET driver_identity_id = di.id
FROM driver_identities di
WHERE di.driver_id = dr.driver_id
  AND di.slot = 1
  AND dr.driver_identity_id IS NULL;

DELETE FROM daily_reports WHERE driver_identity_id IS NULL;

ALTER TABLE daily_reports ALTER COLUMN driver_identity_id SET NOT NULL;

ALTER TABLE daily_reports DROP CONSTRAINT IF EXISTS daily_reports_driver_id_report_date_key;

ALTER TABLE daily_reports
  ADD CONSTRAINT daily_reports_identity_report_date UNIQUE (driver_identity_id, report_date);

CREATE INDEX IF NOT EXISTS idx_daily_reports_driver_identity ON daily_reports (driver_identity_id);
