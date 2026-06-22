-- ============================================================
-- マルチテナント移行 Phase 1 — org_id 列の追加（nullable）＋バックフィル＋index
-- 設計 docs/platform-design.md §6,§7 の対象テーブルに org_id を nullable で足し、
-- 現状は実質 ACE 1社運用のため既存全行を ACE の org_id で一括バックフィルする。
-- NOT NULL / FK / スコープ強制は後続フェーズ（Phase 2,3）で行う。
-- 追加のみ・挙動変更なし。冪等。
-- ============================================================

-- 0) 前提チェック: 082 で ACE テナントが作られていること
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE code = 'ACE') THEN
    RAISE EXCEPTION 'organizations に code=ACE の行がありません。082_organizations.sql を先に適用してください。';
  END IF;
END $$;

-- ---- ルート（テナントを直接保持）----
ALTER TABLE courses ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE courses SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE events ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE events SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE submit_screen_config ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE submit_screen_config SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

-- 希望休 締切設定系
ALTER TABLE shift_request_deadline_config ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE shift_request_deadline_config SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE shift_request_deadline_overrides ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE shift_request_deadline_overrides SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE shift_request_deadline_rules ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE shift_request_deadline_rules SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

-- drivers / invoice_addresses（既存 company_code と当面併存。単一テナントのため全行 ACE）
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE drivers SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE invoice_addresses ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE invoice_addresses SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

-- ---- 集計・高頻度（冗長保持で参照を速く・確実に）----
ALTER TABLE daily_reports_v2 ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE daily_reports_v2 SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE payrolls SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE sales_log_entries ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE sales_log_entries SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE ledger_entries SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

ALTER TABLE oil_change_reports ADD COLUMN IF NOT EXISTS org_id uuid;
UPDATE oil_change_reports SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

-- ---- 車両: 所有テナント（占有=vehicle_loans は別途）----
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_org_id uuid;
UPDATE vehicles SET owner_org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE owner_org_id IS NULL;

-- ---- インデックス（テナント絞り込みの基盤）----
CREATE INDEX IF NOT EXISTS idx_courses_org_id                         ON courses (org_id);
CREATE INDEX IF NOT EXISTS idx_events_org_id                          ON events (org_id);
CREATE INDEX IF NOT EXISTS idx_submit_screen_config_org_id            ON submit_screen_config (org_id);
CREATE INDEX IF NOT EXISTS idx_shift_req_deadline_config_org_id       ON shift_request_deadline_config (org_id);
CREATE INDEX IF NOT EXISTS idx_shift_req_deadline_overrides_org_id    ON shift_request_deadline_overrides (org_id);
CREATE INDEX IF NOT EXISTS idx_shift_req_deadline_rules_org_id        ON shift_request_deadline_rules (org_id);
CREATE INDEX IF NOT EXISTS idx_drivers_org_id                         ON drivers (org_id);
CREATE INDEX IF NOT EXISTS idx_invoice_addresses_org_id               ON invoice_addresses (org_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_v2_org_id                ON daily_reports_v2 (org_id);
CREATE INDEX IF NOT EXISTS idx_payrolls_org_id                        ON payrolls (org_id);
CREATE INDEX IF NOT EXISTS idx_sales_log_entries_org_id               ON sales_log_entries (org_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_org_id                  ON ledger_entries (org_id);
CREATE INDEX IF NOT EXISTS idx_oil_change_reports_org_id              ON oil_change_reports (org_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_org_id                  ON vehicles (owner_org_id);
