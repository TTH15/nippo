# 給与・請求・台帳（お金まわり）フロー（現状＋新モデル接続）設計叩き台

ステータス: ドラフト（合意形成中）／最終更新: 2026-06-21
基盤: `docs/platform-design.md`。連携: `daily-report-flow.md`, 既存 `aggregation-redesign.md`。
方針: 本書はorg_idスコープ等の接続デルタ。**会計モデルそのものの再設計は `financial-model.md`（移転型台帳）**＝お金まわりの背骨はそちらが正。本書のorg_id付与は台帳再設計と整合させて実施。

---

## 0. ★最初に立てる区別：テナント業務会計 ≠ プラットフォーム収益

| | 何 | 誰→誰 | 仕組み |
|---|---|---|---|
| **テナント業務会計**（本書の対象） | ドライバー給与・取引先への請求 | 運営社の中の話 | 既存の集計エンジン（Contribution[]） |
| **プラットフォーム収益**（別物） | 席課金 ¥1,000/人・月（例） | 運営社 → Nippo | 別途サブスク課金（Stripe等）。集計エンジンとは無関係 |

混同しないこと。以下は**テナント業務会計**の話。プラットフォーム収益は別設計（`platform-design.md` 課金）。

---

## 1. 現行フロー（baseline・変えない）

### 1-1. 単一ソース＝Contribution[] を3つに分流
集計コア（`aggregation/compute.ts`）が日報＋台帳から `Contribution[]`（revenue/profit/payout）を生成 → 3シンクへ:
```
Contribution[]（従量=qty×course_unit_rates ＋ 固定=course_fixed_rates ＋ 台帳delta）
  ├─→ 給与（payout）  ← 経費・リース・初期費用回収を控除
  ├─→ 請求（revenue） ← 取引先単位、カスタム/統合明細を加算
  └─→ 利益（profit）  ← 社内用
```
`isCountableReport = approvedAt!=null && rejectedAt==null`。driver_id 中心。

### 1-2. 給与（payroll）
- `payrolls`（driver_id, month, status: DRAFT→CONFIRMED→PAID）。
- 計算（`/api/admin/payments`, `billing/driverPayout.ts`）: payout合計 − `driver_fixed_expenses` − `driver_ad_hoc_expenses` − `driver_leases`(月額/日割) − `vehicle_recovery`（初期費用回収）。
- `driver_optional_expenses` はドライバー自入力。

### 1-3. 請求（invoicing）
- `invoice_documents`（company_code, month, section, counterparty_invoice_address_id, status: draft/sent/paid）。
- ドラフト生成（`/api/admin/invoices/draft`, `billing/computeCounterpartyMonthRevenue.ts`）: 取引先単位に systemLines（course_unit_rates×数量＋course_fixed_rates×承認日数）＋ `sales_log_entries` ＋ `counterparty_monthly_custom_lines` を束ね、`merged_lines`/`line_labels` で統合・上書き。
- 取引先＝`invoice_addresses`（principal=請求元 / counterparty=請求先）。`courses.counterparty_invoice_address_id` で紐付け。

### 1-4. 台帳（ledger_entries）
- 手動調整（残業代/最低保証/立替/リース/控除）。`revenue_delta/profit_delta/payout_delta`（独立・マイナス可）を `target_driver_id`/`course_id`/`counterparty_invoice_address_id` に帰属。
- `ledgerContributions()` で Contribution に合流 → 給与・請求の両方に効く。

### 1-5. 単価マスタ
- 現役: `course_unit_rates`（従量）/`course_fixed_rates`（固定）。廃止: `course_rates`/`rate_master`。

---

## 2. テナントスコープのデルタ（org_id）

- 既に company_code を持つ: `invoice_documents`/`invoice_addresses`/`counterparty_monthly_*` → **org_id へ移行**（スコープ済み）。
- company_code 無し（要追加）: `payrolls`/`ledger_entries`/`driver_fixed_expenses`/`driver_ad_hoc_expenses`/`driver_leases`/`vehicle_recovery_*`/`sales_log_entries`。**org_id を冗長付与**（driver/counterparty経由でも導出できるが集計安全のため直接保持）。
- 集計ローダ（`load.ts`）＋ billing関数（`computeCounterpartyMonthRevenue`/`driverPayout`）に **orgId を必須引数化**（platform-design §3 の単一通り道）。
- `course_unit_rates`/`course_fixed_rates` は course（org所有）経由で自然にorgスコープ（必要なら冗長org_id）。

---

## 3. identity/membership 適合

- **driver_id = membership**（payrolls/ledger.target_driver_id/経費/リース）。給与・請求は個人(membership)単位なので**無改修**。
- 勤務区分（旧driver_identity_id→`work_slot_id`、`daily-report-flow.md` 案A）は日報レベルの関心。給与・請求は driver_id 軸なので影響小。

---

## 4. 取引先(counterparty)と元請け/下請け（現行維持・拡張は将来）

- **現行**: 取引先＝org内部の `invoice_addresses` マスタ（請求先ラベル）。**他orgではない**。
- **新モデルでも当面この前提を維持**（取引先＝同org内マスタ、org_idでスコープ）。
- **将来拡張（保留）**: 元請けもプラットフォームに乗る場合、**org→org billing**（下請けが元請けへ請求／元請けが下請けへ支払）が論点に。これは保留中の元請け→下請け参照（`platform-design.md` §4 course_shares）と**並走する money 版**。
  - そのとき「invoice_address（外部ラベル）」と「実org」の同一性照合が必要。今は別物として扱い、org間 ledger は作らない。

---

## 5. 車両コスト（リース・初期費用回収）の帰属

- 車両はグローバル一意＋owner_org（`platform-design.md` §5）。**リース・初期費用回収は所有orgのコスト**として帰属。
- 稼働の payout は使用org。**会社間貸借時の車両費のorg間精算は将来**（§4のorg→org billingに同梱）。当面は車両費＝owner org内で完結。

---

## 6. データモデルのデルタ

```sql
-- company_code → org_id 移行（請求側）
-- invoice_documents / invoice_addresses / counterparty_monthly_* : company_code を org_id へ

-- org_id 冗長付与（給与・台帳側）
ALTER TABLE payrolls               ADD COLUMN org_id uuid;
ALTER TABLE ledger_entries         ADD COLUMN org_id uuid;
ALTER TABLE driver_fixed_expenses  ADD COLUMN org_id uuid;
ALTER TABLE driver_ad_hoc_expenses ADD COLUMN org_id uuid;
ALTER TABLE driver_leases          ADD COLUMN org_id uuid;
ALTER TABLE vehicle_recovery_collected ADD COLUMN org_id uuid;  -- entries版も
ALTER TABLE sales_log_entries      ADD COLUMN org_id uuid;
-- rates は course 経由でorg（必要なら冗長）
```

---

## 7. 未確定・要確認

1. 取引先＝同org内マスタの前提でよいか（org→org billing は将来でよいか）。← 推奨: 当面そう。
2. driver_*_expenses 等に org_id を直接持つか、driver_id 逆引きで足りるか（推奨: 集計安全のため直接保持）。
3. course rates に org_id を冗長付与するか（course経由で足りるか）。
4. 車両費（リース/回収）の会社間貸借時の精算を、どの時点で設計に入れるか（当面 owner org 内完結）。
5. プラットフォーム席課金（Nippo収益）の課金基盤（Stripe等）の選定 ← 業務会計とは別タスク。

---

## 8. 次アクション（合意後）

1. §7 を確定。
2. 請求側 company_code→org_id 移行＋給与/台帳側 org_id 冗長付与（マルチテナント移行Phaseと同時）。
3. 集計ローダ＋billing関数に orgId 必須化＋API スコープ。
4. （将来）org→org billing と車両費のorg間精算（course_sharesと並走）。
5. （別タスク）プラットフォーム席課金のサブスク基盤。
