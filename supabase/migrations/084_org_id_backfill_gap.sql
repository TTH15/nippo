-- ============================================================
-- マルチテナント移行 Phase 2b-1 — org_id 再バックフィル（ギャップ補修）
-- 083 適用後〜書き込み側 org_id 刻印までの間に作られた行は org_id=NULL のまま。
-- 読み取りを org_id でスコープすると NULL 行が漏れるため、NULL を ACE で埋め直す。
-- 単一テナント前提・追加のみ・冪等。
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE code = 'ACE') THEN
    RAISE EXCEPTION 'organizations に code=ACE の行がありません。082 を先に適用してください。';
  END IF;
END $$;

UPDATE courses                          SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE events                           SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE submit_screen_config             SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE shift_request_deadline_config    SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE shift_request_deadline_overrides SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE shift_request_deadline_rules     SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE drivers                          SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE invoice_addresses                SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE daily_reports_v2                 SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE payrolls                         SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE sales_log_entries                SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE ledger_entries                   SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE oil_change_reports               SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE vehicles                         SET owner_org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE owner_org_id IS NULL;
