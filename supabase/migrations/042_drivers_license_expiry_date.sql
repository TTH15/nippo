-- ドライバー管理: 運転免許証の有効期限
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS license_expiry_date date;
