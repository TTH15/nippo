-- 開発DBで実行する。実データのdriver行は触らず、同じトリガーを一時表で検証する。
-- HAKOTORA_DB_TARGET=dev scripts/db/db.sh dryrun scripts/db/tests/membership-token-version.sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'drivers_token_version'
    AND tgrelid = 'public.drivers'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'drivers trigger is missing';
  END IF;
END $$;
CREATE TEMP TABLE membership_version_probe (
  id integer PRIMARY KEY, name text, status text, role text, role_id uuid,
  org_id uuid, identity_id uuid, token_version integer NOT NULL DEFAULT 0
);
CREATE TRIGGER probe_version BEFORE UPDATE ON membership_version_probe
  FOR EACH ROW EXECUTE FUNCTION public.bump_driver_token_version();
INSERT INTO membership_version_probe (id,name,status,role) VALUES (1,'架空','active','DRIVER');
DO $$
DECLARE version integer;
BEGIN
  UPDATE membership_version_probe SET name='架空2' WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=0, 'profile edit must not revoke';
  UPDATE membership_version_probe SET status='inactive' WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=1, 'deactivation must revoke';
  UPDATE membership_version_probe SET status='active' WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=2, 'reactivation must not restore old token';
  UPDATE membership_version_probe SET role='ADMIN' WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=3, 'role change must revoke';
  UPDATE membership_version_probe SET role_id=gen_random_uuid() WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=4, 'role id change must revoke';
  UPDATE membership_version_probe SET org_id=gen_random_uuid() WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=5, 'org change must revoke';
  UPDATE membership_version_probe SET identity_id=gen_random_uuid() WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=6, 'identity change must revoke';
  UPDATE membership_version_probe SET token_version=0 WHERE id=1 RETURNING token_version INTO version;
  ASSERT version=6, 'version must not go backwards';
END $$;
