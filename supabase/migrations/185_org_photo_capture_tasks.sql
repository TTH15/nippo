-- 会社ごとの追加撮影項目。開始/終了/駐車の固定写真に加えて最大20項目。
-- RLS不使用。管理APIが org_id と capability を確認して読み書きする。
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS photo_capture_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS photo_capture_tasks_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_photo_capture_tasks_array_check CHECK (jsonb_typeof(photo_capture_tasks) = 'array'),
  ADD CONSTRAINT organizations_photo_capture_tasks_version_check CHECK (photo_capture_tasks_version >= 1);

COMMENT ON COLUMN public.organizations.photo_capture_tasks IS
  '追加撮影項目 [{id,label,stage:start|end|parking,required}]。固定の点検・メーターとは別。';
