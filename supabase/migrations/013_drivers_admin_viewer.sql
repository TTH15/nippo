-- drivers.role に ADMIN_VIEWER を追加

ALTER TABLE drivers
  DROP CONSTRAINT IF EXISTS drivers_role_check;

ALTER TABLE drivers
  ADD CONSTRAINT drivers_role_check
  CHECK (role IN ('DRIVER', 'ADMIN', 'ADMIN_VIEWER'));

