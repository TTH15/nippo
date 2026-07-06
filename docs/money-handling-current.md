# 現状のお金の扱い方（実装ベース・現状把握用）

ステータス: 現状把握（**将来構想ではない**）／最終更新: 2026-07-06
位置づけ: 「今のシステムが実際にどうお金を計算・移動させているか」を、コードを見て事実ベースでまとめたもの。
将来の再設計案は別ドキュメント（`docs/financial-model.md`＝移転型台帳の構想、`docs/billing-payroll-flow.md`＝org化のデルタ）を参照。本書はそれらの前提となる「現状」。

---

## 0. 全体の流れ

```
日報 (daily_reports_v2 + report_entries)
  └─ 承認済み(approved_at≠null かつ rejected_at=null)のみ集計対象
       │
       ▼
集計エンジン (server/aggregation/load.ts + compute.ts)
  ├─ 従量分: report_entries(billableな数量) × course_unit_rates
  ├─ 固定分: 稼働1日 × course_fixed_rates（従量と排他ではなく「加算」）
  └─ 台帳(ledger_entries): 手動調整分（revenue/profit/payout_delta）を合流
       │
       ├──────────────┬──────────────────┐
       ▼              ▼                  ▼
  ドライバー給与    請求書(取引先向け)   売上ダッシュボード
  (driverPayout.ts)  (invoice_documents)  (/api/admin/sales)
       │
       ├─ 控除: driver_fixed_expenses / driver_ad_hoc_expenses
       ├─ 控除: リース(driver_leases + courses.daily_lease)
       └─ (別レイヤー) 車両初期費用回収 vehicle_recovery
```

単価マスタ（`course_unit_rates`/`course_fixed_rates`）が唯一の入力元で、そこから「給与」「請求書」「売上ダッシュボード」の3方向にお金の数字が分岐する。

---

## 1. 単価マスタ: course_unit_rates / course_fixed_rates

- `course_unit_rates`（migration `052`）: コース×ユニット単位の**従量**単価。`revenue_per_unit`（売上/個）・`profit_per_unit`（利益/個）・`payout_per_unit`（支払/個）。
- `course_fixed_rates`（migration `056`）: コース単位1行の**固定(日当)**単価。`fixed_revenue`/`fixed_profit`/`fixed_payout`。
- **歩合＋日当が混在するコース**（例: 下京）は、従量と固定が**排他ではなく加算**される設計。集計エンジンが同じ日報から「従量分Contribution」と「固定分Contribution」を両方生成し合算する（`compute.ts`）。
- **保存値は常に税抜**。利益(`profit_per_unit`/`fixed_profit`)は手入力させず、`売上 − 支払`（税抜同士）で自動計算する（`CourseRateEditor.tsx`）。入力ミスで内訳が合わなくなるのを防ぐため。
- **`courses.revenue_tax_basis`/`payout_tax_basis`**（migration `101`、2026-07-06追加）: 「契約上、本当の基準が税抜か税込か」を記録するメタフラグ（`exclusive`/`inclusive`、既定`exclusive`）。**保存値そのものは変えない**（常に税抜のまま）。コース編集画面の税抜/税込トグルの選択を記憶するためのフラグで、請求書側の税抜/税込表示切り替え機能（§5）が将来的に参照する想定。

---

## 2. 集計エンジン（server/aggregation/load.ts + compute.ts）

- `isCountableReport`: `approved_at != null && rejected_at == null` の日報だけが集計対象。未承認・却下は無視される。
- 従量分: `report_entries`のうち`unit_fields.is_billable=true`なフィールドの数量 × `course_unit_rates`。unitごとに個別のContributionとして計上。
- 固定分: そのコースに`course_fixed_rates`が非0で設定されていれば、日報1件＝稼働1日として1回だけ加算。
- `ledger_entries`（revenue_delta/profit_delta/payout_delta）は、自動集計に乗らない手動調整（残業代・最低保証・立替・控除など）を「台帳由来のContribution」として同じ形に変換し合流させる。target_driver_id/course_id/counterparty_invoice_address_idに紐付く。
- この`Contribution[]`が、給与・請求書・売上ダッシュボードすべての**単一の入力**になる（3つが別々に計算し直すのではなく、同じ集計結果を3方向に流用）。

---

## 3. ドライバーへの支払い（給与）

- 実装は`server/billing/driverPayout.ts`の`computeDriverAutoPayout`。`payrolls`テーブルは定義だけ存在し、**アプリからは一切参照されていない未使用のレガシーテーブル**（実際の計算は都度その場で行われ、確定保存されるテーブルは無い）。
- 計算式: `手取り = 自動算出payout − driver_fixed_expenses − driver_ad_hoc_expenses − リース控除`
  - `driver_fixed_expenses`: 月次固定の経費控除（有効期間`valid_from/valid_to`で管理）。
  - `driver_ad_hoc_expenses`: その月だけの単発控除（運営が入力）。
  - `driver_optional_expenses`: ドライバー本人が入力する任意経費。運営側の給与計算には含まれず、本人の確定申告サマリ用。
- ドライバー本人向け画面（`me/rewards`）はほぼ同じ式だが、`driver_ad_hoc_expenses`は符号反転した調整として日別明細に出る。

---

## 4. リース・車両費の扱い

- `driver_leases`（MONTHLY/DAILY）: ドライバーごとに有効なリース契約を1件持つ（`valid_from/valid_to`で期間管理）。
  - **MONTHLY**: 固定額をそのまま毎月控除。
  - **DAILY**: 稼働した日ごとに「その日担当したコースの日額リース（`courses.daily_lease`、複数コース稼働なら最大値を採用）」をユニークな日付で合算（同日に複数コースをやっても二重控除しない）。
- リース金額の**マスタはコース側**（`courses.daily_lease`）。ドライバー側は「なし/月額/日額」のどれを契約しているかだけを持つ。
- 控除は給与計算（§3）の一部として、`server/billing/driverLease.ts`の`computeLeaseDeduction`で計算される。
- **車両の初期費用回収**（`vehicle_recovery`まわり）は給与の控除とは別レイヤー。車両ごとに購入費用に対する回収状況を会社側で管理するシミュレーション機能で、DAILYリースドライバーの利用実績から自動計上される分＋手動入力行を合算し、残り回収額を算出する。ドライバー個人の手取りには直接影響しない（会社の資産管理側の話）。

---

## 5. 請求書（invoice_documents）

- 1テーブルで**取引先向け（売上請求書=outgoing）**と**ドライバーからの受領請求書（incoming）**の両方を扱う。DBカラムではなく、`payload.parties`（`toParty`/`fromParty`）の値からその都度どちらか判定する（`toParty="ace_creation"`かつ`fromParty`が`drv-`始まりならincoming）。
- `payload.tableData.main`（請求分）/`deduct`（お支払い分）は各行`{title, qty, unit, price, priceBasis}`。**`priceBasis`は2026-07-06に追加**（`"exclusive"|"inclusive"`、未設定は`exclusive`扱い）。行ごとに「入力した単価が税抜か税込か」を持てる。
- **請求書全体の表示基準 `payload.displayBasis`**（`"exclusive"|"inclusive"`）: 行の`priceBasis`と異なる行だけ自動換算して表示・集計する。税抜↔税込は`packages/core/src/logic/taxBasis.ts`の`exclusiveOf`/`inclusiveOf`（税込→税抜は`floor(x/1.1)`、税抜→税込は`round(x×1.1)`、四捨五入と切り捨てで非対称なので完全な往復変換ではない）。
  - これにより、コースによって「税抜で契約」「税込で契約」がバラバラでも、**1枚の請求書のまま**「取引先送付用（税込表示）」「税務提出用（税抜表示）」を切り替えて確認・印刷できる。以前は請求書を複製する「ペア機能」を試みたが、既存請求書がどちらの基準か機械判定できず誤変換するバグが出たため撤去し、この「1枚＋表示切替」方式に置き換えた（詳細は memory: invoice-tax-basis-pairing）。
- **`extraOutsourcingExclusive`/`extraOutsourcingInclusive`**: 「売上追加分/追加外注請求分」の手動調整額を、税抜表示用・税込表示用で別々に持つ。単価×数量の丸め誤差は数量が多いほど蓄積するため、税込側の実入金額と税抜側の会計上あるべき額が一致しない場合があり、モードごとに独立して端数調整できるようにしている。
- 金額計算は`@repo/core/logic/reward.ts`の`computeInvoiceTotals`。`displayBasis="exclusive"`なら各行合算後に消費税を外税で加算（切り捨て）。`displayBasis="inclusive"`なら行合計（税込）から税抜相当額を内税で逆算する（二重課税を避けるため、「足す」のではなく「戻す」）。最終的な差引き請求額 = 請求(税込) − お支払い(税込) − 借入返済 + 追加外注（現在の表示基準側の値）。
- 請求書ドラフトの自動生成（`/api/admin/invoices/draft`）は、取引先を指定すると`buildCounterpartyBillingSnapshot`が集計エンジンの結果からコース×ユニット×ドライバー別の明細行を自動で組み立てる。郵便局区分だけは集計エンジンを通らず`sales_log_entries`（手動売上ログ）を使う。

---

## 6. 売上ダッシュボード（/admin/sales）

- データソースは集計エンジン（§2）そのもの。日別に「ヤマト」「Amazon」（自動算出、キャリア区分で振り分け）「その他」（台帳ではなく`sales_log_entries`の手動調整）「利益」を積み上げる。
- 表示指標: 合計売上、粗利（売上−支払）、1日あたり平均（売上・利益）、粗利率、稼働率、ドライバー1人あたり売上。裏付けとなる「承認済み日報の件数」も併記し、集計の信頼度を可視化している。

---

## 7. 消費税の扱い

- 請求書は`taxEnabled`（ON/OFF）と`taxRatePercent`（既定10%）を持つ。OFFなら税額は常に0。
- 外税/内税の分岐は§5の`displayBasis`が担う。exclusive表示＝外税加算、inclusive表示＝内税で逆算。
- コース単価側の税抜/税込判定は、単価マスタ（§1）の`revenue_tax_basis`/`payout_tax_basis`と請求書側の`priceBasis`は**別の概念**（前者はコースマスタのメタ情報、後者は個々の請求書の明細行が実際にどちらで入力されたか）。今のところ両者は自動連携しておらず、請求書の各行にどちらの基準で単価を打つかは、請求書を作る人が都度判断して行ごとのトグルで指定する。

---

## 8. 既知の制限・注意点

- **単価マスタに履歴がない**: `course_unit_rates`/`course_fixed_rates`は「現在の値」しか持たない。過去の単価変更を遡って正確に再現することはできない（過去請求書の一括インポート時はこの制約により、historical importでは判明している範囲で手動補正した。詳細は memory: fixed-unit-daycount-aggregation-plan）。
- **`payrolls`テーブルは未使用**: スキーマ上は存在するが、実際の給与計算はその場で計算されるのみで、確定値として保存する仕組みは現状ない。
- **請求書の税抜/税込は行ごと・都度判断**: コースマスタの`tax_basis`フラグと請求書の`priceBasis`はまだ自動連携していないため、請求書作成時に人が正しく設定する必要がある。
- **`extraOutsourcing`系の値は手動調整**: 集計と実入出金のズレを自動で解消する仕組みはまだなく、差額を都度手入力している（将来課題として memory: invoice-reconciliation-automation-goal に記録）。

---

## 関連ドキュメント

- `docs/financial-model.md` — 将来構想（移転型台帳への再設計案、ドラフト）
- `docs/billing-payroll-flow.md` — 将来のorg化に向けたデルタ設計（現状のbaselineも§1に記載）
- `docs/aggregation-redesign.md` — 集計エンジン刷新の経緯
