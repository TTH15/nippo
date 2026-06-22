-- ============================================================
-- マルチテナント移行 Phase 3 — org_id を NOT NULL 化＋FK付与（G2 解消）
-- 前提: Phase 2 で全書き込みが org_id を刻むようになっている。
-- 念のため NULL を ACE で再バックフィルしてから、FK→NOT NULL を当てる。
-- 冪等（FKは存在チェック、SET NOT NULL/UPDATEは何度でも安全）。
--   設計: docs/platform-design.md §6,§7 Phase 3
-- ============================================================

DO $$
DECLARE
  ace uuid;
  t text;
  fk text;
  -- org_id 列を持つテナント表（vehicles は owner_org_id なので別扱い）
  tables text[] := ARRAY[
    'courses','events','submit_screen_config',
    'shift_request_deadline_config','shift_request_deadline_overrides','shift_request_deadline_rules',
    'drivers','invoice_addresses','daily_reports_v2','payrolls','sales_log_entries',
    'ledger_entries','oil_change_reports','invoice_documents',
    'counterparty_monthly_custom_lines','counterparty_monthly_line_labels','counterparty_monthly_merged_lines'
  ];
BEGIN
  SELECT id INTO ace FROM organizations WHERE code = 'ACE';
  IF ace IS NULL THEN
    RAISE EXCEPTION 'organizations に code=ACE がありません。082 を先に適用してください。';
  END IF;

  FOREACH t IN ARRAY tables LOOP
    -- 1) NULL を ACE で埋める（移行後ギャップの最終補修）
    EXECUTE format('UPDATE %I SET org_id = $1 WHERE org_id IS NULL', t) USING ace;
    -- 2) FK（無ければ追加）
    fk := 'fk_' || t || '_org';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id) REFERENCES organizations(id)',
        t, fk
      );
    END IF;
    -- 3) NOT NULL 化
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
  END LOOP;

  -- vehicles は owner_org_id
  UPDATE vehicles SET owner_org_id = ace WHERE owner_org_id IS NULL;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vehicles_owner_org') THEN
    ALTER TABLE vehicles ADD CONSTRAINT fk_vehicles_owner_org FOREIGN KEY (owner_org_id) REFERENCES organizations(id);
  END IF;
  ALTER TABLE vehicles ALTER COLUMN owner_org_id SET NOT NULL;
END $$;
