-- 振込先の支店と預金種目を別項目で保持する。既存の銀行・支店一体文字列は分割しない。
BEGIN;
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS bank_branch_name text,
  ADD COLUMN IF NOT EXISTS bank_account_type text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_bank_branch_name_nonempty' AND conrelid = 'public.drivers'::regclass) THEN
    ALTER TABLE public.drivers ADD CONSTRAINT drivers_bank_branch_name_nonempty CHECK (bank_branch_name IS NULL OR length(trim(bank_branch_name)) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_bank_account_type_valid' AND conrelid = 'public.drivers'::regclass) THEN
    ALTER TABLE public.drivers ADD CONSTRAINT drivers_bank_account_type_valid CHECK (bank_account_type IS NULL OR bank_account_type IN ('ordinary', 'current', 'savings'));
  END IF;
END;
$$;
COMMENT ON COLUMN public.drivers.bank_branch_name IS '振込口座の支店名。旧データはNULLのまま。';
COMMENT ON COLUMN public.drivers.bank_account_type IS '振込口座の預金種目: ordinary=普通、current=当座、savings=貯蓄。旧データはNULL。';
COMMIT;
