# マルチテナント化 設計叩き台

ステータス: ドラフト（合意形成中）／最終更新: 2026-06-21
関連方針: `構成A`（クライアントは Next.js API 経由のみ。Supabase直結なし。テナント分離はAPI層で一本化、**RLSは使わない**）

---

## 0. 前提となる重要な発見

このアプリは**ゼロからのマルチテナント化ではない**。すでに「ソフトなマルチテナント」が部分的に存在する。

- JWT ペイロードに `companyCode` を保持済み（`src/server/auth/jwt.ts`）。
- ログイン時に `drivers.company_code` から自動付与（`src/app/api/auth/login/route.ts`、ドライバー/管理者とも）。
- 運営者・ドライバーは同一 `drivers` テーブルに `role`（DRIVER / ADMIN / ADMIN_VIEWER）で同居し、全員 `company_code` で会社に紐づく。
- 運営系APIの多くがすでに `.eq("company_code", user.companyCode)` で会社絞り込み済み（例: `admin/users`, `admin/payments`）。
- `companies` テーブルが存在（`id uuid` / `code text UNIQUE` / `name`）。ただし**他テーブルからのFK参照は無く**、`drivers.company_code` は緩い TEXT 直結。

→ 本作業の本質は「**既存テナント概念の完全化・整合化・厳格化**」。新しいテナントモデルの発明ではない。

---

## 1. 現状のギャップ（＝直すべきこと）

| # | ギャップ | リスク |
|---|---------|--------|
| G1 | **絞り込みが不徹底**。`courses`/`vehicles`/`shifts` のクエリに会社フィルタが無い | 2社目で他社データが混ざる |
| G2 | **整合性が無い**。`company_code` は FK 制約のない TEXT | データ不整合・孤児行 |
| G3 | **強制が分散**。各ルートが手書きで `.eq(...)`。書き忘れ＝素通し | テナント越境漏洩 |
| G4 | **会社列を持たない根テーブルがある**（courses/vehicles/events/submit_screen_config/締切系） | 会社で分けられない |
| G5 | **共有マスタの境界が未定義**（carriers/units/report_kinds 等） | 移行方針が定まらない |
| G6 | **YAMATO/AMAZON のハードコード**が複数ルートに残存 | 会社別キャリアで破綻 |

---

## 2. テナント識別モデル（確定方針）

「内部キー」と「人が打ち込むコード」を分離する。1つのコードに役割を兼任させない。

| 役割 | 用途 | 性質 | 例 |
|---|---|---|---|
| **org_id（UUID）** | 内部キー。全テーブルのFK、テナント分離はこれで行う | **不変・人に見せない** | `7f3a…` |
| **join_code（英数6文字）** | ドライバーがアプリで打ち込む**参加用招待コード** | **再生成可能**（漏れたら作り直す） | `K7M2QP` |
| 表示コード（legacy company_code） | 運営画面で人が会社を識別する表札。既存3文字 `ACE` を退避 | 可変・表示専用 | `ACE` |

- テナント分離が依存するのは **org_id のみ**。ドライバーはUUIDを見ない（打つのは join_code）。
- join_code は再生成可能。改名・衝突しても内部の org_id 紐付けは壊れない。
- 実質「内部は UUID 正規化（旧案B）＋人には優しいコードを被せる」形。

### 2-1. ドライバー参加フロー（join_code＋承認）

```
1. 会社作成時に org_id(UUID) と join_code(英数6文字) を自動発行
2. 運営が join_code をドライバーへ配布（LINE等）
3. ドライバーがアプリで join_code を入力 → org を逆引き
   → drivers 行を status='pending' で作成し org_id を紐付け
4. その会社の運営画面に「承認待ち」一覧が出る
5. 運営が承認 → status='active' で本稼働（却下も可）
```

- 1社=1つの共有 join_code で十分（ドライバー毎の固有発行は不要）。漏洩時は運営が再生成。
- **承認必須**（承認なし即有効にはしない）。コードが漏れても勝手に中へ入れない安全策。

### 2-2. 認可・JWT

- JWT は「ユーザーの所属org 1つ」だけ持つ。**1ユーザー=1ホーム会社**を基本とする。
- 会社をまたぐ参照権限は JWT に焼き込まず、クエリ時に後述のグラント表から都度解決（取消が即反映される）。

---

## 3. テナント分離の実装（API層・default-deny、RLSなし）

- `src/server/db/tenant.ts`（新規）に **org_id スコープを必ず付与する薄いラッパ**を用意。各ルートの手書き `.eq` は廃止していく。
- 既存の一元化済みローダ（`src/server/aggregation/legacyShape.ts` の `loadLegacyDailyRows()`、`loadAggregationData()` 等）に **orgId 引数を必須化**して差し込む（集計の単一通り道）。
- 「会社スコープ未適用のクエリを書けない/検出できる」状態を目標に、レビュー観点 or 簡易 lint（`from("drivers")` 直書き検出）で担保。

### 3-1. テナント列を直接持つか親経由か

- **根（ルート）テーブルは org_id を直接持つ**: `drivers`✓, `invoice_addresses`✓, `courses`✕追加, `vehicles`(→§5特例), `events`✕追加, `submit_screen_config`✕追加, 締切設定系✕追加
- **集計・高頻度は冗長でも直接持つ**: `daily_reports_v2`, `payrolls`, `sales_log_entries`, `ledger_entries`, `oil_change_reports`
- **持たない（親経由で決定）**: `driver_identities`/`driver_courses`/`shift_requests`/`report_entries`/`counterparty_monthly_*`/`event_*` 等の子テーブル

### 3-2. 共有マスタ vs テナント別

| 分類 | テーブル | 方針 |
|------|---------|------|
| 全社共通（org列なし） | `report_kinds`, `sales_log_types`, `unit_fields`, `rate_master` | 共有。会社別上書きが要る時に nullable owner 列で後付け |
| キャリア系（共有＋会社別有効化） | `carriers`, `units`, `shift_request_slots` | マスタは共有。「どの会社がどのキャリアを使うか」は `company_carriers` 中間表 |
| テナント別（org列必須） | `drivers`/`courses`/`vehicles`/`invoice_addresses`/`events`/`submit_screen_config`/締切系 | 会社で分離 |

---

## 4. 会社をまたぐ参照（元請け→下請け）★土台のみ確保・実装は保留

要件が未確定（元請けがアプリを使うか不明／コース名が両社で異なる／下請けは複数元請けにぶら下がる）。**今は作り込まず、土台だけ将来対応可能にする。**

確定した考え方：

- **共有の単位は「会社」ではなく「コース」**。下請けは複数元請けにぶら下がるため、元請けごとに見せるコースが違う。`org_grants`(会社丸ごと)は粗すぎ、`course_shares`(コース単位)が正しい粒度。
- **消費側のテナント性を切り離す**。中身（コース単位の報告）と届け方を分離：
  - 元請けが**アプリを使う** → `course_shares` でその運営画面に該当コースの報告だけ表示。
  - 元請けが**使わない** → トークン付き閲覧リンク or エクスポート（PDF/CSV、ログイン不要・読み取り専用）。
- **見せる範囲は報告（配送実績）のみ**。給与・個人情報・口座は対象外（scope で遮断）。
- **コース名不一致**は共有時の任意エイリアスで吸収（仕上げ。後回し）。
- 実装方式（in-app / 外部リンク）は実需が出てから確定。

**今ロックする土台**: `courses.org_id`、報告がコース×期間で取り出せる構造。これがあれば `course_shares`/エクスポートは後からスキーマ改修なしで追加可。

---

## 5. 車両のグローバル一意化と会社間貸借 ★土台のみ確保

会社をまたぐ車両貸借があるため、車両は org で厳密分割しない特例とする。

- **車両アイデンティティはグローバル一意**：QRは `vehicles.id`(UUID) を指す。会社をまたいでも同じ車両は同じID。
- **所有と占有を分離**：`vehicles.owner_org_id`（所有者）＋ 貸出記録（**既存 `vehicle_loans` が土台**）で「A社の車両を期間PだけB社へ貸与中」を表現。
- メーター等は車両に紐づくため、会社をまたいで自動で引き継がれる（=情報の自動反映）。
- テナント分離は「owner_org_id で管理＋貸与中はサーバー側で借用orgの可視集合に追加」という §4 と同じ"明示的に広げる例外"パターン。
- **借用側に見せる情報は限定**（運行に必要なメーター/ナンバーのみ。所有者のリース代・財務は不可）。

---

## 6. 対象テーブルと変更（org_idベース）

```sql
-- テナント表（既存 companies を昇格 or organizations 新設）
-- id uuid PK / name / join_code text UNIQUE / display_code text(旧company_code)

-- ルート（直接保持）
ALTER TABLE courses              ADD COLUMN org_id uuid;
ALTER TABLE events               ADD COLUMN org_id uuid;
ALTER TABLE submit_screen_config ADD COLUMN org_id uuid;
ALTER TABLE shift_request_deadline_config    ADD COLUMN org_id uuid;
ALTER TABLE shift_request_deadline_overrides ADD COLUMN org_id uuid;
ALTER TABLE shift_request_deadline_rules     ADD COLUMN org_id uuid;
-- drivers, invoice_addresses は company_code→org_id へ移行

-- 集計・高頻度（冗長保持）
ALTER TABLE daily_reports_v2  ADD COLUMN org_id uuid;
ALTER TABLE payrolls          ADD COLUMN org_id uuid;
ALTER TABLE sales_log_entries ADD COLUMN org_id uuid;
ALTER TABLE ledger_entries    ADD COLUMN org_id uuid;
ALTER TABLE oil_change_reports ADD COLUMN org_id uuid;

-- 車両: 所有者
ALTER TABLE vehicles ADD COLUMN owner_org_id uuid;

-- ドライバー参加フロー
ALTER TABLE drivers ADD COLUMN status text NOT NULL DEFAULT 'active'; -- pending/active/rejected

-- キャリア有効化（会社別）
CREATE TABLE company_carriers (
  org_id uuid NOT NULL, carrier_id uuid NOT NULL REFERENCES carriers(id),
  PRIMARY KEY (org_id, carrier_id)
);

-- 【保留・土台のみ】会社をまたぐコース共有（実装は実需が出てから）
-- CREATE TABLE course_shares (course_id uuid, consumer_org_id uuid NULL, scope text, ...);
```

子テーブルは追加しない（親経由で決定）。

---

## 7. 移行・バックフィル手順（段階的）

現在は実質1社運用。既存データは現会社の org_id で一括バックフィルできる。

- **Phase 0 — 正式化**: `companies`→`organizations` 整備（id/name/join_code/display_code）。現運用会社の行をシード、join_code 発行。
- **Phase 1 — 列追加（nullable）＋バックフィル**: §6 の org_id 列を nullable 追加、既存全行を現 org_id で UPDATE。`(org_id, …)` インデックス付与。
- **Phase 2 — 強制の一元化**: `tenant.ts` ＋ 既存ローダ改修で全ルートを org_id スコープ経由に置換。G1 の未絞り込みクエリを潰す。手書き `.eq` 撤去。
- **Phase 3 — 制約強化**: org_id を NOT NULL 化、FK 付与（G2 解消）。
- **Phase 4 — ハードコード解消**: YAMATO/AMAZON 分岐（G6）を `carriers`＋`company_carriers` 駆動へ。運営日報の固定表示も会社別動的化（`admin-daily-legacy-display` 参照）。
- **Phase 5 — 参加フロー**: join_code 入力API・承認/却下API・`status` 運用を実装。
- **Phase 6 — 隔離テスト**: 2社目を作り、A社ログインでB社データが一切見えないことを Vitest で自動検証。

各 Phase は独立リリース可。**Phase 2 完了まで2社目を本番投入しない**こと。

---

## 8. 保留（実需が出てから・土台は確保済み）

- **真の二重所属**（1ドライバーが複数会社で独立稼働）: 当面は 1ユーザー=1ホーム会社。`driver_identities`(2スロット) で部分対応しつつ、grant で表現しきれない実例が出たら多対多へ拡張。
- **元請け→下請けのコース共有**（§4）: `course_shares`／外部エクスポート／コース別名。
- **車両の会社間貸借UX**（§5）: 借用org可視化・スコープ絞り。
- **company_code→org_id の完全廃止**: 当面 display_code として共存。

---

## 9. 未確定・要確認

1. `carriers`/`units` は「共有マスタ＋会社別有効化」でよいか。
2. 既存 `companies` 行は現運用1社のみか。バックフィル時の org_id 確定。
3. 旧 `daily_reports`(v1) は今も直接参照が多いか。org_id 追加対象に含めるか。
4. ドライバーの `status` 既定値: 既存ドライバーは 'active' で移行、新規参加のみ 'pending'。

---

## 10. 次アクション（合意後）

1. §9 を確定。
2. Phase 0/1 マイグレーション（organizations整備＋org_id列＋バックフィル＋インデックス）作成。
3. `src/server/db/tenant.ts` ＋ 既存ローダ改修でスコープ一元化（Phase 2）。
4. テナント越境テストを Vitest に追加（`testing-suite` 参照）。
