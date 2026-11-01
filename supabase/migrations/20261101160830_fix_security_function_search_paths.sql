-- Existing functions remain SECURITY INVOKER with unchanged ACL and bodies.
SET LOCAL lock_timeout = '5s';
ALTER FUNCTION public.admin_daily_pending_dates(uuid,date,date) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.admin_daily_unread_count(uuid,date,date) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.chat_thread_summaries(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.map_latest_positions(uuid,timestamptz) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.map_latest_sessions(uuid,timestamptz) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.vehicle_daily_lease_agg(uuid,uuid[]) SET search_path = pg_catalog, public, pg_temp;
