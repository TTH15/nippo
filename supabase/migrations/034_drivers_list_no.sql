-- ドライバー一覧の「No.」を永続化（会社コード単位で DRIVER に通し番号）

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS list_no integer;

-- 既存の DRIVER のみ、名前・ID 順で 1 から採番
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_code
           ORDER BY name ASC, id ASC
         ) AS rn
  FROM drivers
  WHERE role = 'DRIVER'
)
UPDATE drivers d
SET list_no = ranked.rn
FROM ranked
WHERE d.id = ranked.id;

-- 同一会社内で DRIVER の list_no は一意
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_company_list_no_driver
  ON drivers (company_code, list_no)
  WHERE role = 'DRIVER' AND list_no IS NOT NULL;
