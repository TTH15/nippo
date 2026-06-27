-- ============================================================
-- 車両貸借: 借用org の記録（QR認可・テナント可視化の土台）
-- 既存 vehicle_loans（070）は「日毎の貸出中」フラグのみで借用先orgを持たない。
-- 会社を跨いだ車両QRの認可（=その日その車を借りているorgか）を判定できるよう、
-- 借用org列を追加する。追加のみ・既存挙動不変。冪等。
--   設計: docs/vehicle-session-flow.md §8.1,§13 / docs/platform-design.md §5
-- ============================================================

ALTER TABLE vehicle_loans
  ADD COLUMN IF NOT EXISTS borrower_org_id uuid REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_vehicle_loans_borrower ON vehicle_loans (borrower_org_id);
-- QR解決時の「その車・その日・その借用org」逆引き用
CREATE INDEX IF NOT EXISTS idx_vehicle_loans_vehicle_date ON vehicle_loans (vehicle_id, loan_date);

COMMENT ON COLUMN vehicle_loans.borrower_org_id IS '貸与先(借用)org。null=外部/未指定。車両QRのテナント横断認可（所有org or 有効貸与の借用org）に使用';
