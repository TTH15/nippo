-- ============================================================
-- マルチテナント移行 Phase 2d-1 — 請求系テーブルに org_id を追加
-- company_code だけで絞っていた請求系テーブル（org_id 列が無かったもの）に
-- org_id を nullable で足し、既存全行を ACE で backfill する。
-- これにより後続（2d-2）で .eq("company_code") を .eq("org_id") へ置換できる。
-- 単一テナント前提・追加のみ・冪等。company_code 列は display 用に当面残す。
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE code = 'ACE') THEN
    RAISE EXCEPTION 'organizations に code=ACE の行がありません。082 を先に適用してください。';
  END IF;
END $$;

ALTER TABLE invoice_documents                ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE counterparty_monthly_custom_lines ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE counterparty_monthly_line_labels  ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE counterparty_monthly_merged_lines ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE invoice_documents                 SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE counterparty_monthly_custom_lines SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE counterparty_monthly_line_labels  SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;
UPDATE counterparty_monthly_merged_lines SET org_id = (SELECT id FROM organizations WHERE code = 'ACE') WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_documents_org_id                 ON invoice_documents (org_id);
CREATE INDEX IF NOT EXISTS idx_cp_monthly_custom_lines_org_id           ON counterparty_monthly_custom_lines (org_id);
CREATE INDEX IF NOT EXISTS idx_cp_monthly_line_labels_org_id            ON counterparty_monthly_line_labels (org_id);
CREATE INDEX IF NOT EXISTS idx_cp_monthly_merged_lines_org_id           ON counterparty_monthly_merged_lines (org_id);
