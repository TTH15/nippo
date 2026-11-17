-- 個人に追加する権限。対象は drivers の所属単位で、役割の束とは独立して保持する。
-- アクセスは既存のサーバー経由に限定する。認可判定・変更APIの実装は別途必要。
BEGIN;

CREATE TABLE public.member_capability_grants (
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (length(capability) BETWEEN 1 AND 100),
  granted_by uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, capability)
);

ALTER TABLE public.member_capability_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_capability_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.member_capability_grants TO service_role;

CREATE TABLE public.member_capability_grant_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  target_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  actor_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  capability text NOT NULL,
  enabled boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.member_capability_grant_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_capability_grant_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.member_capability_grant_history_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.member_capability_grant_history TO service_role;
GRANT USAGE ON SEQUENCE public.member_capability_grant_history_id_seq TO service_role;

CREATE FUNCTION public.set_member_capability_grant(p_org uuid, p_actor uuid, p_target uuid, p_capability text, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE changed integer;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_target IS NULL OR p_enabled IS NULL OR p_capability IS NULL OR length(p_capability) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid grant' USING ERRCODE = '22023';
  END IF;
  IF p_capability='can_view_profit' AND p_enabled THEN
    RAISE EXCEPTION '利益の閲覧は経営・経理の役割で設定してください' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_actor AND org_id = p_org AND status = 'active') THEN
    RAISE EXCEPTION 'Invalid actor' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.drivers WHERE id = p_target AND org_id = p_org AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid target' USING ERRCODE = 'P0002'; END IF;
  IF p_enabled THEN
    INSERT INTO public.member_capability_grants(driver_id, capability, granted_by)
      VALUES (p_target, p_capability, p_actor) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.member_capability_grants WHERE driver_id = p_target AND capability = p_capability;
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed > 0 THEN
    INSERT INTO public.member_capability_grant_history(org_id, target_driver_id, actor_driver_id, capability, enabled)
      VALUES (p_org, p_target, p_actor, p_capability, p_enabled);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_member_capability_grant(uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_capability_grant(uuid, uuid, uuid, text, boolean) TO service_role;

INSERT INTO public.role_capabilities(role_id, capability)
SELECT r.id, cap.capability FROM public.roles r
CROSS JOIN (VALUES ('can_view_sales'), ('can_view_profit')) AS cap(capability)
WHERE r.is_system = true AND r.key IN ('ADMIN', 'ACCOUNTING')
ON CONFLICT DO NOTHING;

COMMIT;
