CREATE TABLE public.spot_jobs (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
 "org_id" uuid NOT NULL,
 "title" text NOT NULL,
 "job_date" date NOT NULL,
 "meeting_place" text,
 "meeting_time" time without time zone,
 "end_time" time without time zone,
 "client_name" text,
 "billing_amount" integer,
 "note" text,
 "status" text DEFAULT 'planned'::text NOT NULL,
 "created_by" uuid,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.spot_job_members (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
 "job_id" uuid NOT NULL,
 "driver_id" uuid,
 "display_name" text,
 "pay_amount" integer,
 "vehicle_id" uuid,
 "note" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX spot_member_driver_unique ON public.spot_job_members(job_id,driver_id) WHERE driver_id IS NOT NULL;
ALTER TABLE public.spot_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spot_job_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.spot_jobs,public.spot_job_members TO service_role;

