BEGIN;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS bank_account_type_other text;
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_bank_account_type_valid;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_bank_account_type_valid CHECK (bank_account_type IS NULL OR bank_account_type IN ('ordinary', 'current', 'savings', 'other'));
ALTER TABLE public.drivers ADD CONSTRAINT drivers_bank_account_type_other_valid CHECK (
  (bank_account_type IS NOT DISTINCT FROM 'other' AND bank_account_type_other IS NOT NULL AND length(trim(bank_account_type_other)) BETWEEN 1 AND 40 AND trim(bank_account_type_other) <> 'その他')
  OR (bank_account_type IS DISTINCT FROM 'other' AND bank_account_type_other IS NULL)
);
COMMENT ON COLUMN public.drivers.bank_account_type IS 'ordinary=普通、current=当座、savings=貯蓄、other=その他（具体名は別列）。';
COMMENT ON COLUMN public.drivers.bank_name IS '新規保存は金融機関名のみ。旧データには支店との結合表記がある。';
COMMENT ON COLUMN public.drivers.bank_no IS '新規保存は口座番号のみ。旧データには種別との結合表記がある。';
COMMENT ON COLUMN public.drivers.bank_account_type_other IS 'その他を選んだ場合の具体的な預金種目。';
COMMIT;
