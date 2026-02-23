-- ============================================================
-- 法人アドレス帳（請求書用）
-- 会社コードに紐づき、どのデバイスからもアクセス可能
-- ============================================================

CREATE TABLE IF NOT EXISTS invoice_addresses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code text       NOT NULL,
  name        text        NOT NULL,
  postal_code text,
  address     text,
  phone       text,
  invoice_no  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_addresses_company_code ON invoice_addresses (company_code);
