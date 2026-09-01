-- シフト表専用の行順。名簿No.（list_no）や請求・日報の順序は変更しない。
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS shift_sort_order integer;

CREATE INDEX IF NOT EXISTS idx_drivers_org_shift_sort_order
  ON drivers (org_id, shift_sort_order)
  WHERE works_as_driver = true AND shift_sort_order IS NOT NULL;

-- 配列の順番を1回のトランザクションで反映する。
CREATE OR REPLACE FUNCTION reorder_shift_drivers(p_org_id uuid, p_driver_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  requested_count integer := COALESCE(array_length(p_driver_ids, 1), 0);
  matching_count integer;
BEGIN
  IF p_org_id IS NULL OR requested_count < 1 OR requested_count > 1000 THEN
    RAISE EXCEPTION 'invalid shift driver order';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_driver_ids) AS item(driver_id)
    GROUP BY item.driver_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate driver id';
  END IF;

  SELECT count(*) INTO matching_count
  FROM drivers
  WHERE org_id = p_org_id
    AND works_as_driver = true
    AND status = 'active'
    AND id = ANY(p_driver_ids);

  IF matching_count <> requested_count THEN
    RAISE EXCEPTION 'driver outside organization or inactive';
  END IF;

  UPDATE drivers AS driver
  SET shift_sort_order = ordered.position::integer
  FROM unnest(p_driver_ids) WITH ORDINALITY AS ordered(driver_id, position)
  WHERE driver.id = ordered.driver_id
    AND driver.org_id = p_org_id
    AND driver.works_as_driver = true
    AND driver.status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION reorder_shift_drivers(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reorder_shift_drivers(uuid, uuid[]) TO service_role;
