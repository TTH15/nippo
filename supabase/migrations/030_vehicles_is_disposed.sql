-- 車両の廃車フラグ
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS is_disposed boolean NOT NULL DEFAULT false;
