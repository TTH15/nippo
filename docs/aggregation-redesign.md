# 集計システム刷新 設計ドキュメント

最終更新: 2026-05-30

## 1. 背景と目的

現行システムはキャリア（配送案件）が `YAMATO | AMAZON | OTHER` の固定 enum として
コード全体にハードコーディングされている。このため:

- ヤマトのシフトに入っているドライバーの user 画面にも Amazon の入力ボックスが出る等、
  キャリアに応じた出し分けが硬直的。
- 郵便局・企業配など新案件が増えるたびに、DB スキーマ・API・全画面の改修が必要。
- 報告項目（`takuhaibin_completed` 等）が固定カラムで、増減に弱い。
- 請求セクション (`"Amazon" | "ヤマト運輸" | "郵便局"`) が複数ファイルに重複定義。

**目的**: キャリア・unit（型）・報告項目・単価を **運営画面の設定から作成可能**にし、
コードを触らずに新案件へ拡張できる構造へ刷新する。

## 2. 中核コンセプト

```
Carrier（キャリア）          例: ヤマト / Amazon / 郵便局 / 企業配
  └─ Unit（型 / 集計の単位）   例: 宅急便, ネコポス / Amazon配送
       ├─ 報告フィールド群      ドライバーに何を入力させるか（運営が型付きビルダーで定義）
       └─ 課金ルール            報告値 → 売上・利益・ドライバー支払 の算出方法（従量 / 固定）
```

unit は3つの役割を一身に束ねる:
1. **報告** — ドライバー画面に出す入力ボックスの定義（unit ごとに可変）
2. **集計の型** — 売上集計・グラフ・請求の明細単位が unit
3. **課金** — unit ごとに課金タイプ（従量 / 固定）を持ち、単価は course×unit で設定

## 3. 集計の2層モデル

集計を **「① 自動算出」＋「② 手動調整（台帳）」** に分離する。これが本設計の要。

### レイヤー① 自動算出（ルールベース・報告値から確定的に計算）

課金は **2つのコンポーネントの「加算」**（排他ではない）:

```
そのシフトの 売上 = 従量分 + 固定分
  従量分 = Σ(報告の数量フィールド × course_unit_rates の単価)   例: 宅急便 完了個数 × 単価
  固定分 = course_fixed_rates の日当（1シフト1回）              例: Amazon, 日当
（利益・ドライバー支払も同じく加算。どちらかが 0 なら自然に片方だけになる）
```

- **加算モデルにより、1シフトの途中で歩合↔日当が切り替わる混在コース（例: 下京）**も
  「報告個数ぶんの歩合 ＋ 日当」を自動合算でき、毎回の手動補正が不要になる。
- 報告値に対して機械的に売上/利益/支払を出すだけで、**ここには一切の手動調整を入れない**。
- 固定ドライバー支払 = `max(0, fixed_revenue − fixed_profit)`（現行ロジック踏襲）。

### レイヤー② 手動調整（台帳・既存「ログ」を一般化）

- **残業代・最低保証の上乗せ・立替費用・リース代・控除** を 1 つのテーブルに統一。
- 立替/リースと残業代が **同じ画面・同じフロー** で入力できる（既存「ログ」の発展形）。
- 1 エントリで「ドライバー支払を増やす / 取引先請求(売上)に上乗せ / 会社利益に反映」を
  個別の delta として表現できる。
- **最低保証は自動ルールにしない**（会社として一律保証はできず日によるため、
  手動修正の余地を残すという要件に基づく）。保証上乗せが必要な日だけ台帳エントリで対応する。

### 集計式（全画面共通）

```
売上 = Σ(自動算出 revenue over reports) + Σ(ledger.revenue_delta)
利益 = Σ(自動算出 profit)               + Σ(ledger.profit_delta)
支払 = Σ(自動算出 payout)               + Σ(ledger.payout_delta)
```

これを carrier / unit / course / driver / counterparty 軸で集計する。
admin/sales・payments・invoices が全てこの式に乗る。

## 4. データモデル（新スキーマ）

> 既存テーブルは**バックアップとして温存**し（DROP しない）、新テーブルへデータをコピー流用する。
> 詳細は「7. 移行方針」を参照。新規マイグレーションは `051_` 以降の3桁連番で追加する。

### 4.1 マスタ（運営設定）

```sql
-- キャリア
carriers (
  id uuid pk,
  name text not null,            -- ヤマト / Amazon / 郵便局 / 企業配
  code text unique,              -- 内部コード（請求番号生成等で使用）
  sort_order int default 0,
  active boolean default true,
  created_at timestamptz
)

-- unit（型）
units (
  id uuid pk,
  carrier_id uuid not null references carriers(id),
  name text not null,            -- 宅急便 / ネコポス / Amazon-AM …
  code text,
  billing_type text not null check (billing_type in ('PER_PIECE','FIXED')),
  sort_order int default 0,
  active boolean default true,
  created_at timestamptz,
  unique (carrier_id, name)
)

-- unit の報告フィールド定義（型付きビルダー）
unit_fields (
  id uuid pk,
  unit_id uuid not null references units(id) on delete cascade,
  field_key text not null,       -- completed / returned / mochidashi …（unit 内で一意）
  label text not null,           -- 完了個数 / 持戻個数 …
  input_type text not null check (input_type in ('INT','TEXT','TIME','BOOL')),
  group_label text,              -- AM / PM / 4時 などの見出しグルーピング用
  is_billable boolean default false, -- 従量課金の数量として使うフィールドか
  required boolean default false,
  sort_order int default 0,
  unique (unit_id, field_key)
)
```

### 4.2 コース・単価

```sql
-- courses は既存を流用。carrier を FK 化する。
-- alter table courses add column carrier_id uuid references carriers(id);
-- （旧 carrier text 列はバックアップとして残置）

-- 従量分: course × unit ごとの単価
course_unit_rates (
  id uuid pk,
  course_id uuid not null references courses(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  revenue_per_unit int default 0,   -- 売上単価/個
  profit_per_unit int default 0,    -- 利益/個
  payout_per_unit int default 0,    -- ドライバー支払/個
  updated_at timestamptz,
  unique (course_id, unit_id)
)
-- ※ 052 で作成済の fixed_* 列は course_fixed_rates へ移したため使用しない。

-- 固定分: コース単位の固定(日当)コンポーネント（従量と「加算」される・排他ではない）
course_fixed_rates (
  course_id uuid pk references courses(id) on delete cascade,
  fixed_revenue int default 0,   -- 1シフトあたり 売上（日当）
  fixed_profit int default 0,    -- 1シフトあたり 利益
  fixed_payout int default 0,    -- 1シフトあたり ドライバー支払（日当）
  updated_at timestamptz
)
-- 行が無い/0 のコースは従量のみ。両方セットなら混在（歩合＋日当）として加算。
```

### 4.3 日報（報告）

```sql
-- ヘッダ（既存 daily_reports を作り直す。下記は新テーブル想定）
daily_reports_v2 (
  id uuid pk,
  driver_id uuid not null references drivers(id) on delete cascade,
  report_date date not null,
  course_id uuid references courses(id),  -- その日のシフト＝コースから決定
  carrier_id uuid references carriers(id),-- course から導出して冗長保持（集計高速化）
  submitted_at timestamptz default now(),
  -- 承認ワークフロー（既存踏襲）
  approved_at timestamptz, approved_by uuid references drivers(id),
  rejected_at timestamptz, rejected_by uuid references drivers(id),
  unique (driver_id, report_date, course_id)
)

-- 報告値の実体（縦持ち / EAV）
report_entries (
  id uuid pk,
  report_id uuid not null references daily_reports_v2(id) on delete cascade,
  unit_id uuid not null references units(id),
  field_key text not null,
  value_num numeric,    -- INT/TIME 系
  value_text text,      -- TEXT/BOOL 系
  unique (report_id, unit_id, field_key)
)
```

**設計判断**: 報告値は縦持ち（EAV）を採用。フィールドが運営定義で増減するため、
固定カラムや jsonb より集計（unit×field 単位の合算）が SQL で素直に書ける。

### 4.4 手動調整（台帳）

```sql
-- 既存 sales_log_types を流用しつつ汎用化
ledger_entries (
  id uuid pk,
  entry_date date not null,
  type_id uuid references sales_log_types(id), -- 残業/保証/立替/リース/控除/その他
  content text,
  -- 影響（それぞれ独立に設定可。マイナス可）
  revenue_delta int default 0,   -- 取引先請求(売上)への影響
  profit_delta int default 0,    -- 会社利益への影響
  payout_delta int default 0,    -- ドライバー支払への影響
  -- 帰属・紐付け
  target_driver_id uuid references drivers(id),
  course_id uuid references courses(id),
  counterparty_invoice_address_id uuid references invoice_addresses(id),
  created_at timestamptz
)
```

旧 `sales_log_entries`（revenue/profit/attribution）と取引先カスタム行は
この `ledger_entries` に統合する。

## 5. 影響範囲（画面・API）

| 区分 | 対象 | 改修内容 |
|---|---|---|
| 運営設定(新規) | `/admin/carriers`(新) | キャリア・unit・unit_fields の CRUD |
| 運営設定 | `/admin/courses` | carrier_id 選択、course_unit_rates 編集に置換 |
| user | `/(user)/submit` | キャリア固定タブを廃止。シフトのコース→carrier→units を動的レンダリング |
| 集計 | `/admin/daily` | report_entries ベースの動的表示 |
| 集計 | `/admin/sales` | 2層集計式に置換。carrier/unit 軸でグループ化 |
| 集計 | `/admin/payments` | 自動算出 payout + ledger payout_delta |
| 請求 | `/admin/invoices` ほか | 固定 Section enum を廃止、carrier 派生に |
| ログ | `/admin/sales`(ログ) | ledger_entries に統合（残業/保証/立替/リース） |
| API | `/api/reports` ほか | report_entries 読み書き、集計ユーティリティ共通化 |

キャリア⇄セクション変換など散在ロジックは `src/server/aggregation/` 等に集約する。

## 6. 確定した設計判断

- 報告はその日の **シフト（＝コース）** に対して行う。ドライバーは自分でキャリアを選ばず、
  シフトから carrier/units を自動決定する。
- `report_entries` は縦持ち（EAV）。
- 課金は **従量(course_unit_rates) + 固定(course_fixed_rates) の「加算」**（排他ではない）。
  混在コース（歩合＋日当、例: 下京）も自動合算でき、手動補正が不要になる。
  成果ベース・時間ベースは ledger の手動調整で吸収。
- 最低保証は自動化せず、必要な日に ledger エントリで手動対応。
- **Amazon は 1 unit「Amazon配送」（FIXED / 1シフト固定額）**。午前/午後/4便は unit_fields の
  `group_label` で表現する（報告値は時間帯別に保持、課金は固定額1本）。
  時間帯別の個数は集計画面で内訳表示できるが、課金額は時間帯で分けない。
  ※ 報告値（午前/午後/4便の持出・完了）は unit 構成に関係なくそのまま移行できる。

## 7. 移行方針（既存データのバックアップ＋コピー流用）

**原則: 既存テーブル・データは DROP せず温存する。** 新テーブルを追加し、
既存データをコピー＆変換して新構造へ流し込む（同じデータを両方で保持）。

### 7.1 マスタのシード

既存の固定キャリア/型を新マスタへ投入:

- `carriers`: 「ヤマト」「Amazon」（必要なら「郵便局」「企業配」）
- `units`:
  - ヤマト → 宅急便(PER_PIECE), ネコポス(PER_PIECE)
  - Amazon → Amazon配送(FIXED) ※1 unit
- `unit_fields`:
  - 宅急便 → 完了(INT, is_billable), 持戻(INT)
  - ネコポス → 完了(INT, is_billable), 持戻(INT)
  - Amazon配送 → am_mochidashi/am_completed(午前), pm_*(午後), four_*(4便) の6フィールド

### 7.2 単価のコピー（加算モデル）

`course_rates` → `course_unit_rates`（従量分）＋ `course_fixed_rates`（固定分）:

| 旧カラム | 新 |
|---|---|
| `takuhaibin_revenue/profit/driver_payout` | （ヤマト系）宅急便 `course_unit_rates` の revenue/profit/payout_per_unit |
| `nekopos_revenue/profit/driver_payout` | （ヤマト系）ネコポス `course_unit_rates` |
| `fixed_revenue/fixed_profit` | `course_fixed_rates`（キャリア不問）。`fixed_payout = max(0, fixed_revenue − fixed_profit)` |

- 従量分と固定分は別テーブルに入り、集計時に加算される。両方を持つコース（下京等）は
  従量・固定の両行が作られ、自動で合算される。
- ⚠️ 注意: 旧実装は「fixed>0 なら従量を無視」する排他仕様だったため、混在コースの過去分は
  歩合を手動補正していた可能性がある。新モデルで歩合を自動加算すると、その手動分（ledger）と
  二重計上になり得る。過去データの整合は Phase 3（集計）/ Phase 8（台帳）で個別に確認する。

### 7.3 日報のコピー

`daily_reports`（固定カラム）→ `daily_reports_v2` + `report_entries`:

- carrier=YAMATO の行 → 宅急便/ネコポス unit の completed/returned を `report_entries` 化
- carrier=AMAZON の行 → Amazon配送 unit の am_*/pm_*/four_* 6フィールドを `report_entries` 化
- 承認状態・日付・driver は header にコピー
- course_id は同日同ドライバーの shift から逆引きして補完

### 7.4 台帳のコピー（058）

旧「手動調整」は2テーブルに分かれている。両方を `ledger_entries` に統合する。

**`sales_log_entries` → `ledger_entries`（会社側）**
- `revenue` → `revenue_delta`, `profit` → `profit_delta`, `payout_delta = 0`
- `target_driver_id` / `counterparty_invoice_address_id` / `type_id` を引き継ぎ

**`driver_ad_hoc_expenses` → `ledger_entries`（ドライバー側 支払調整）**
- `payout_delta = -amount`（正＝控除→支払マイナス、負＝手当→支払プラス。payments の `net = 収入 − 控除` を踏襲）
- `entry_date = month の月初`、`target_driver_id` を引き継ぎ

**リンク済みペア（単発報酬: sales_log↔ad_hoc）** は2行のまま移行。別ストリーム
（会社利益 vs ドライバー支払）なので二重計上にならず、新集計＝旧画面の表示と一致する。
将来UIで1エントリ（複数delta）に統合表示することは可能。

冪等性: `ledger_entries` に `legacy_sales_log_id` / `legacy_ad_hoc_expense_id` を持たせ、
`ON CONFLICT` で再実行安全にしている。

### 7.5 ロールバック

新テーブルを DROP すれば旧テーブルだけで現行どおり動く状態を維持する
（カットオーバーまで旧テーブルを参照する画面と新テーブル参照の画面を切替可能にしておく）。

## 8. 実装フェーズ（計画）

1. **マイグレーション**: 新テーブル作成（既存は温存）＋マスタのシード（`051_` 以降）。
2. **移行スクリプト**: 7.2〜7.4 のコピー変換（冪等な seed/transform スクリプト）。
3. **集計ユーティリティ**: 2層集計式を `src/server/aggregation/` に実装＋ユニットテスト。
4. **運営設定 UI**: `/admin/carriers`（キャリア/unit/フィールド CRUD）。
5. **コース UI**: course_unit_rates 編集へ置換。
6. **user 日報 UI**: シフト→carrier→units の動的フォーム。
7. **集計画面**: daily / sales / payments を新集計に接続。
8. **請求・ログ**: invoices のセクション派生化、ledger 統合。
9. **カットオーバー**: 全画面を新テーブル参照へ切替。旧テーブルはバックアップとして残置。
