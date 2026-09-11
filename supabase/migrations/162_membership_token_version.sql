SET LOCAL lock_timeout = '3s';

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0
  CHECK (token_version >= 0);

CREATE OR REPLACE FUNCTION public.bump_driver_token_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.role IS DISTINCT FROM NEW.role
     OR OLD.role_id IS DISTINCT FROM NEW.role_id
     OR OLD.org_id IS DISTINCT FROM NEW.org_id
     OR OLD.identity_id IS DISTINCT FROM NEW.identity_id THEN
    NEW.token_version := OLD.token_version + 1;
  ELSE
    -- 手動失効の世代増加は許可するが、古い世代には戻さない。
    NEW.token_version := GREATEST(OLD.token_version, NEW.token_version);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_driver_token_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_driver_token_version() TO service_role;
DROP TRIGGER IF EXISTS drivers_token_version ON public.drivers;
CREATE TRIGGER drivers_token_version BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.bump_driver_token_version();
