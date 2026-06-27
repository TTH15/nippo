-- ============================================================
-- 車両QR — ローテーション式トークン
-- QRには vehicles.id を直書きせず「不透明トークン」を埋め、サーバが token→vehicle を解決。
-- 再発行で旧トークンを失効（偽造・重複入力・紛失ラベルの不正使用を防止）。
-- ライフサイクル: issued(印刷済) → active(ADMIN貼付確認) → revoked(再発行/手動失効)。
-- 追加のみ・既存挙動不変。冪等。RLS不使用＝アプリ層 org_id スコープ。
--   設計: docs/vehicle-session-flow.md §8 / docs/platform-design.md §5（車両グローバルID・貸借）
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicle_qr (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES organizations(id),  -- 発行org（所有org）。発行/失効/有効化の権限元
  token       text        NOT NULL UNIQUE,                        -- 128bitランダム→URLセーフ22文字（QRに埋める値）
  version     integer     NOT NULL DEFAULT 1,                     -- 再発行で +1

  status      text        NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued', 'active', 'revoked')),

  issued_at             timestamptz NOT NULL DEFAULT now(),
  issued_by             uuid        REFERENCES drivers(id) ON DELETE SET NULL,  -- 発行した membership
  attached_confirmed_at timestamptz,                                            -- 貼付確認(有効化)時刻
  attached_confirmed_by uuid        REFERENCES drivers(id) ON DELETE SET NULL,  -- 有効化した ADMIN 等
  revoked_at            timestamptz
);

-- 有効(issued/active)トークンは車両に常に1つだけ。revoked は履歴として残す。
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_qr_active   ON vehicle_qr (vehicle_id) WHERE status <> 'revoked';
-- token は UNIQUE 制約のインデックスで解決（token→vehicle・グローバル）。追加indexは不要。
CREATE INDEX        IF NOT EXISTS idx_vehicle_qr_vehicle  ON vehicle_qr (vehicle_id);
CREATE INDEX        IF NOT EXISTS idx_vehicle_qr_org      ON vehicle_qr (org_id);

COMMENT ON TABLE  vehicle_qr IS '車両QRのローテーション式トークン。再発行で旧失効・ADMIN貼付確認で有効化（vehicle-session-flow §8）';
COMMENT ON COLUMN vehicle_qr.token IS '不透明トークン（QRペイロード nippo://v/<token>）。解決はテナント横断・認可は別レイヤ（所有org or 有効貸与の借用org）';
