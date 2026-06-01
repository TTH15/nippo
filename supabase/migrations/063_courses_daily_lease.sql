-- コースごとの日額リース代（円/稼働日）。
-- 日額リースのドライバーは、その日に走ったコースの daily_lease を日当から控除し、
-- 同額をそのドライバーが使った車両の初期費用回収へ自動計上する（vehicle_recovery v2）。
-- ドライバー側は「なし/月額/日額」の選択のみで、日額の金額はコースが正となる。
ALTER TABLE courses ADD COLUMN IF NOT EXISTS daily_lease int NOT NULL DEFAULT 0;

COMMENT ON COLUMN courses.daily_lease IS '日額リース代(円/稼働日)。日額リースのドライバーの控除額・車両回収の自動計上額に使用';
