-- ============================================================
-- 集計刷新 Phase1: マスタのシード（既存の固定キャリア/型を新マスタへ）
-- 冪等。codes は移行スクリプト(Phase2)からの参照に使う。
-- ============================================================

-- キャリア
INSERT INTO carriers (name, code, sort_order) VALUES
  ('ヤマト', 'YAMATO', 1),
  ('Amazon', 'AMAZON', 2)
ON CONFLICT (name) DO NOTHING;

-- unit（carrier を code で解決）
-- Amazon は 1 unit（固定/シフト）。AM/PM/4便 は unit_fields の group_label で表現する。
INSERT INTO units (carrier_id, name, code, billing_type, sort_order)
SELECT c.id, v.name, v.code, v.billing_type, v.sort_order
FROM (VALUES
  ('YAMATO', '宅急便',      'TAKUHAIBIN',       'PER_PIECE', 1),
  ('YAMATO', 'ネコポス',    'NEKOPOS',          'PER_PIECE', 2),
  ('AMAZON', 'Amazon配送',  'AMAZON_DELIVERY',  'FIXED',     1)
) AS v(carrier_code, name, code, billing_type, sort_order)
JOIN carriers c ON c.code = v.carrier_code
ON CONFLICT (carrier_id, name) DO NOTHING;

-- unit_fields（unit を code で解決）
-- field_key は旧 daily_reports カラム（amazon_am_mochidashi 等）に対応させ、移行を素直にする。
INSERT INTO unit_fields (unit_id, field_key, label, input_type, group_label, is_billable, sort_order)
SELECT u.id, v.field_key, v.label, v.input_type, v.group_label, v.is_billable, v.sort_order
FROM (VALUES
  -- 宅急便
  ('TAKUHAIBIN',      'completed',      '完了個数', 'INT', NULL,   true,  1),
  ('TAKUHAIBIN',      'returned',       '持戻個数', 'INT', NULL,   false, 2),
  -- ネコポス
  ('NEKOPOS',         'completed',      '完了個数', 'INT', NULL,   true,  1),
  ('NEKOPOS',         'returned',       '持戻個数', 'INT', NULL,   false, 2),
  -- Amazon配送（午前/午後/4便のグループ）
  ('AMAZON_DELIVERY', 'am_mochidashi',  '持出個数', 'INT', '午前', false, 1),
  ('AMAZON_DELIVERY', 'am_completed',   '完了個数', 'INT', '午前', false, 2),
  ('AMAZON_DELIVERY', 'pm_mochidashi',  '持出個数', 'INT', '午後', false, 3),
  ('AMAZON_DELIVERY', 'pm_completed',   '完了個数', 'INT', '午後', false, 4),
  ('AMAZON_DELIVERY', 'four_mochidashi','持出個数', 'INT', '4便',  false, 5),
  ('AMAZON_DELIVERY', 'four_completed', '完了個数', 'INT', '4便',  false, 6)
) AS v(unit_code, field_key, label, input_type, group_label, is_billable, sort_order)
JOIN units u ON u.code = v.unit_code
ON CONFLICT (unit_id, field_key) DO NOTHING;

-- courses.carrier_id を旧 carrier text 列から設定（未設定のみ）
UPDATE courses SET carrier_id = (SELECT id FROM carriers WHERE code = 'YAMATO')
  WHERE carrier = 'YAMATO' AND carrier_id IS NULL;
UPDATE courses SET carrier_id = (SELECT id FROM carriers WHERE code = 'AMAZON')
  WHERE carrier = 'AMAZON' AND carrier_id IS NULL;
-- carrier = 'OTHER' は対応キャリア未定のため carrier_id は NULL のまま残す。
