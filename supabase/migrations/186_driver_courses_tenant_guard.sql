-- Restore the driver/course organization invariant without another FK path.
-- The composite FKs in 178 caused ambiguous PostgREST embeds and were removed in 180.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.driver_courses dc
    JOIN public.drivers d ON d.id = dc.driver_id
    JOIN public.courses c ON c.id = dc.course_id
    JOIN public.driver_identities di ON di.id = dc.driver_identity_id
    WHERE d.org_id IS DISTINCT FROM c.org_id
       OR di.driver_id IS DISTINCT FROM d.id
       OR (dc.org_id IS NOT NULL AND dc.org_id IS DISTINCT FROM d.org_id)
  ) THEN
    RAISE EXCEPTION 'driver_courses contains cross-organization or mismatched identity rows';
  END IF;
END $$;

UPDATE public.driver_courses dc SET org_id = d.org_id
FROM public.drivers d WHERE d.id = dc.driver_id AND dc.org_id IS NULL;
ALTER TABLE public.driver_courses ALTER COLUMN org_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_driver_course_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  driver_org uuid;
  course_org uuid;
  identity_driver uuid;
BEGIN
  -- FOR SHARE also serializes a concurrent move of either parent to another org.
  SELECT org_id INTO driver_org FROM public.drivers WHERE id = NEW.driver_id FOR SHARE;
  SELECT org_id INTO course_org FROM public.courses WHERE id = NEW.course_id FOR SHARE;
  SELECT driver_id INTO identity_driver FROM public.driver_identities
    WHERE id = NEW.driver_identity_id FOR SHARE;
  IF driver_org IS NULL OR course_org IS NULL OR identity_driver IS NULL
     OR driver_org IS DISTINCT FROM course_org
     OR identity_driver IS DISTINCT FROM NEW.driver_id
     OR (NEW.org_id IS NOT NULL AND NEW.org_id IS DISTINCT FROM driver_org) THEN
    RAISE EXCEPTION 'driver_courses organization mismatch' USING ERRCODE = '23514';
  END IF;
  NEW.org_id := driver_org;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_driver_courses_tenant ON public.driver_courses;
CREATE TRIGGER trg_driver_courses_tenant
  BEFORE INSERT OR UPDATE OF driver_id, driver_identity_id, course_id, org_id
  ON public.driver_courses FOR EACH ROW EXECUTE FUNCTION public.guard_driver_course_tenant();

CREATE OR REPLACE FUNCTION public.guard_driver_course_parent_move()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'drivers' AND OLD.org_id IS DISTINCT FROM NEW.org_id
     AND EXISTS (SELECT 1 FROM public.driver_courses WHERE driver_id = OLD.id) THEN
    RAISE EXCEPTION 'remove driver course assignments before changing organization' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'courses' AND OLD.org_id IS DISTINCT FROM NEW.org_id
     AND EXISTS (SELECT 1 FROM public.driver_courses WHERE course_id = OLD.id) THEN
    RAISE EXCEPTION 'remove driver course assignments before changing organization' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'driver_identities' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id
     AND EXISTS (SELECT 1 FROM public.driver_courses WHERE driver_identity_id = OLD.id) THEN
    RAISE EXCEPTION 'remove course assignments before moving driver identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_driver_courses_driver_move ON public.drivers;
CREATE TRIGGER trg_driver_courses_driver_move BEFORE UPDATE OF org_id ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_course_parent_move();
DROP TRIGGER IF EXISTS trg_driver_courses_course_move ON public.courses;
CREATE TRIGGER trg_driver_courses_course_move BEFORE UPDATE OF org_id ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_course_parent_move();
DROP TRIGGER IF EXISTS trg_driver_courses_identity_move ON public.driver_identities;
CREATE TRIGGER trg_driver_courses_identity_move BEFORE UPDATE OF driver_id ON public.driver_identities
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_course_parent_move();

COMMIT;
