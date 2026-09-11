-- これまで共有していた種別設定を会社単位に固定する。
-- 各社が現在見ている設定を維持し、以後の変更だけを分離する。
LOCK TABLE public.report_kinds IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.report_kinds ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.report_kinds DROP CONSTRAINT IF EXISTS report_kinds_key_key;

DO $$
DECLARE legacy_org uuid;
BEGIN
  SELECT id INTO legacy_org FROM public.organizations WHERE code = 'ACE';
  IF EXISTS (SELECT 1 FROM public.report_kinds WHERE org_id IS NULL) THEN
    IF legacy_org IS NULL THEN
      RAISE EXCEPTION 'Legacy organization is missing; report kinds migration aborted';
    END IF;
    -- 083と同じ既定会社のIDを残す。他社の複製には新しいIDを割り当てる。
    INSERT INTO public.report_kinds (
      org_id, key, label, sort_order, is_active, uses_location, uses_odometer,
      uses_description, uses_amount, description_required, description_label,
      capability, created_at, updated_at, uses_vehicle, fields, vehicle_mode
    )
    SELECT o.id, k.key, k.label, k.sort_order, k.is_active, k.uses_location, k.uses_odometer,
      k.uses_description, k.uses_amount, k.description_required, k.description_label,
      k.capability, k.created_at, k.updated_at, k.uses_vehicle, k.fields, k.vehicle_mode
    FROM public.report_kinds k CROSS JOIN public.organizations o
    WHERE k.org_id IS NULL AND o.id <> legacy_org
      AND NOT EXISTS (SELECT 1 FROM public.report_kinds own WHERE own.org_id = o.id AND own.key = k.key);
    UPDATE public.report_kinds SET org_id = legacy_org WHERE org_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.report_kinds ALTER COLUMN org_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS report_kinds_org_key ON public.report_kinds(org_id, key);
CREATE INDEX IF NOT EXISTS report_kinds_org_sort ON public.report_kinds(org_id, sort_order);
REVOKE ALL ON TABLE public.report_kinds FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
