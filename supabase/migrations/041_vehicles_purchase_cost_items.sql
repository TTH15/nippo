-- 車両の購入費用の内訳（加算/減算）を保持する
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS purchase_cost_items jsonb;

