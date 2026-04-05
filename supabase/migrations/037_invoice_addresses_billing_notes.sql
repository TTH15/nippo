-- 取引先（請求先）向けの社内メモ（車両リース内訳など）。請求書PDFには出さない想定。
ALTER TABLE invoice_addresses
  ADD COLUMN IF NOT EXISTS billing_notes text;

COMMENT ON COLUMN invoice_addresses.billing_notes IS '社内向けメモ（車両リース・備考など）。取引先画面で編集。';
