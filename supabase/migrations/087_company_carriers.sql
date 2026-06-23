-- ============================================================
-- マルチテナント Phase 4 — キャリアの会社別有効化（company_carriers）
-- carriers は共有マスタのまま、どの org がどのキャリアを使うかを company_carriers で表す。
-- 既存 ACE は全キャリア有効で backfill（＝挙動不変）。追加のみ・冪等。
--   設計: docs/platform-design.md §6
-- ============================================================

CREATE TABLE IF NOT EXISTS company_carriers (
  org_id     uuid        NOT NULL REFERENCES organizations(id),
  carrier_id uuid        NOT NULL REFERENCES carriers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, carrier_id)
);

-- ACE を全既存キャリアに紐付け（冪等）
DO $$
DECLARE ace uuid;
BEGIN
  SELECT id INTO ace FROM organizations WHERE code = 'ACE';
  IF ace IS NULL THEN
    RAISE EXCEPTION 'organizations に code=ACE がありません。082 を先に適用してください。';
  END IF;
  INSERT INTO company_carriers (org_id, carrier_id)
  SELECT ace, c.id FROM carriers c
  ON CONFLICT (org_id, carrier_id) DO NOTHING;
END $$;
