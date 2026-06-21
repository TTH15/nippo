# マルチテナント化 設計叩き台

ステータス: ドラフト（合意前）／最終更新: 2026-06-21
関連方針: `構成A`（クライアントは Next.js API 経由のみ。Supabase直結なし。テナント分離はAPI層で一本化、**RLSは使わない**）

---

## 0. 前提となる重要な発見

このアプリは**ゼロからのマルチテナント化ではない**。すでに「ソフトなマルチテナント」が部分的に存在する。

- JWT ペイロードに `companyCode` を保持済み（`src/server/auth/jwt.ts`）。
- ログイン時に `drivers.company_code` から自動付与（`src/app/api/auth/login/route.ts`、ドライバー/管理者とも）。
- 運営者・ドライバーは同一 `drivers` テーブルに `role`（DRIVER / ADMIN / ADMIN_VIEWER）で同居し、全員 `company_code` で会社に紐づく。
- 運営系APIの多くがすでに `.eq("company_code", user.companyCode)` で会社絞り込み済み（例: `admin/users`, `admin/payments`）。
- `companies` テーブルが存在（`id uuid` / `code text UNIQUE` / `name`）。ただし**他テーブルからのFK参照は無く**、`drivers.company_code` は緩い TEXT 直結。

→ したがって本作業の本質は「**既存テナント概念の完全化・整合化・厳格化**」であり、新しいテナントモデルの発明ではない。

---

## 1. 現状のギャップ（＝直すべきこと）

| # | ギャップ | リスク |
|---|---------|--------|
| G1 | **絞り込みが不徹底**。`courses` / `vehicles` / `shifts` などのクエリに会社フィルタが無い | 2社目を載せた瞬間に他社のコース・車両・シフトが見える/混ざる |
| G2 | **整合性が無い**。`company_code` は FK 制約のない TEXT。タイプミス・孤児行を防げない | データ不整合、誤った会社への紐付け |
| G3 | **強制が分散**。各ルートが手書きで `.eq("company_code", ...)`。書き忘れ＝そのルートが素通し | テナント越境漏洩（1か所の書き忘れが事故に直結） |
| G4 | **会社列を持たない根テーブルがある**（`courses`, `vehicles`, `events`, `submit_screen_config`, 締切設定系 等） | そもそも会社で分けられない |
| G5 | **共有マスタの境界が未定義**（`carriers`, `units`, `report_kinds` 等は全社共通か会社別か） | 設計が定まらないと移行できない |
| G6 | **YAMATO/AMAZON のハードコード**が複数ルートに残存 | 会社ごとに扱うキャリアが違うと破綻 |

---

## 2. 設計判断（要・合意）

### D1. テナントキーをどうするか ★最重要

| 案 | 内容 | 利点 | 欠点 |
|----|------|------|------|
| **A（推奨）** | 既存の `company_code`(TEXT) をテナントキーとして据え置き、`companies` を正式なテナント表に昇格、FK と欠落列追加で「硬く」する | JWT/ログイン/既存クエリをそのまま再利用。最小改修で最速。ロールバック容易 | キーが可変な3文字テキスト。会社増加で改名・衝突リスク |
| B | `organizations(id uuid)` を導入し、全テーブル・JWT・全クエリを `org_id` UUID へ移行 | 正規・将来安全。テナントIDが不変 | JWT/ログイン/全クエリ/全テーブルに波及。今やると高コスト・高リスク |

**推奨: 案A で進める。** ただし `companies` を `organizations` 相当に整備し、後日 B へ移れる形にしておく。
3文字コードの脆さ対策として、`companies.code` は**今後の新規会社では生成・一意・長さ拡張**を許容するルールに変更（既存 'ACE' 等はそのまま）。

> 確認したい点: 当面 A でよいか。それとも最初から org_id(UUID) で正規化（B）したいか。

### D2. テナント列を「直接持つ」か「親経由」か

原則: **根（ルート）テーブルは会社列を直接持つ。子テーブルは親を辿って決まるので持たない。**
ただし例外として、**集計・高頻度クエリのテーブルは冗長でも会社列を直接持つ**（JOIN削減・絞り込み安全性のため）。

- **会社列を直接持つ（ルート）**: `drivers`✓既存, `invoice_addresses`✓既存, `courses`✕追加, `vehicles`✕追加, `events`✕追加, `submit_screen_config`✕追加, 締切設定系✕追加
- **冗長に直接持つ（集計効率＋安全）**: `daily_reports_v2`, `payrolls`, `sales_log_entries`, `ledger_entries`, `oil_change_reports`
- **持たない（親経由で決定）**: `driver_identities`/`driver_courses`/`shift_requests`/`report_entries`/`vehicle_*`/`counterparty_monthly_*`/`event_teams`/`event_point_entries` など子テーブル群

### D3. 共有マスタ vs テナント別

| 分類 | テーブル | 方針 |
|------|---------|------|
| 全社共通（会社列なし） | `report_kinds`, `sales_log_types`, `unit_fields`, `rate_master` | 共有のまま。会社別の上書きが要るときに「nullable owner列」で後付け |
| キャリア系（共有＋会社別有効化） | `carriers`, `units`, `shift_request_slots` | マスタは共有。**「どの会社がどのキャリアを使うか」は会社別設定**（中間表 or `companies.enabled_carriers`）で表現 |
| テナント別（会社列必須） | `drivers`, `courses`, `vehicles`, `invoice_addresses`, `events`, `submit_screen_config`, 締切設定系 | 会社で分離 |

### D4. テナント分離の強制方法（API層・RLSなし）

**default-deny を1か所で強制する**。各ルートの手書き `.eq` は廃止していく。

- `src/server/db/tenant.ts`（新規）に **テナントスコープ付きクエリヘルパー**を用意。例:
  ```ts
  // user.companyCode を必ず付与する薄いラッパ
  export function scoped(supabase, table, user) {
    return supabase.from(table).eq("company_code", user.companyCode);
  }
  ```
- さらに、`src/server/aggregation/legacyShape.ts` の `loadLegacyDailyRows()` や `loadAggregationData()` など**既存の一元化済みローダに companyCode 引数を必須化**して差し込む（ここが集計の単一通り道）。
- 「**会社スコープ未適用のクエリを書けない/見つけられる**」状態を目標に、レビュー観点 or 簡易 lint（`from("drivers")` 直書き検出など）で担保。

---

## 3. 対象テーブルと変更（案Aベース）

会社列は当面 `company_code text` を追加（将来 org_id 化する場合に備え、`companies.code` への FK を張る）。

```sql
-- ルート（直接保持）
ALTER TABLE courses              ADD COLUMN company_code text;
ALTER TABLE vehicles             ADD COLUMN company_code text;
ALTER TABLE events               ADD COLUMN company_code text;
ALTER TABLE submit_screen_config ADD COLUMN company_code text;
ALTER TABLE shift_request_deadline_config    ADD COLUMN company_code text;
ALTER TABLE shift_request_deadline_overrides ADD COLUMN company_code text;
ALTER TABLE shift_request_deadline_rules     ADD COLUMN company_code text;
-- drivers, invoice_addresses は既存

-- 集計・高頻度（冗長保持）
ALTER TABLE daily_reports_v2  ADD COLUMN company_code text;
ALTER TABLE payrolls          ADD COLUMN company_code text;
ALTER TABLE sales_log_entries ADD COLUMN company_code text;
ALTER TABLE ledger_entries    ADD COLUMN company_code text;
ALTER TABLE oil_change_reports ADD COLUMN company_code text;

-- キャリア有効化（会社別）: 中間表
CREATE TABLE company_carriers (
  company_code text NOT NULL,
  carrier_id   uuid NOT NULL REFERENCES carriers(id),
  PRIMARY KEY (company_code, carrier_id)
);
```

※ 子テーブルは追加しない（親経由で決定）。

---

## 4. 移行・バックフィル手順（段階的・無停止寄り）

現在は実質1社運用なので、既存データは「現会社コード」で一括バックフィルできる。

- **Phase 0 — 正式化**: `companies` を正式テナント表として整備（必要なら `organizations` へ改称）。現運用会社の行を確認/シード。
- **Phase 1 — 列追加（nullable）**: §3 の列を nullable で追加。既存全行を現会社コードで `UPDATE` バックフィル。インデックス `(company_code, ...)` 付与。
  - 例: `UPDATE courses SET company_code = 'ACE' WHERE company_code IS NULL;`
- **Phase 2 — 強制の一元化**: §2-D4 のヘルパー/ローダ改修を入れ、**全ルートを会社スコープ経由に置換**。`courses`/`vehicles`/`shifts` 等の未絞り込みクエリ（G1）を潰す。手書き `.eq` を撤去。
- **Phase 3 — 制約強化**: 列を `NOT NULL` 化、`company_code` に `companies.code` への FK を付与（G2 解消）。
- **Phase 4 — ハードコード解消**: YAMATO/AMAZON 分岐（G6）を `carriers` + `company_carriers` 駆動の動的処理へ。運営日報の固定表示（`admin-daily-legacy-display` 参照）も会社別動的化。
- **Phase 5 — 隔離テスト**: テスト用2社目を作成し、A社ログインでB社データが一切見えないことを自動テストで確認（テナント越境テストを CI に追加）。

各 Phase は独立リリース可能。Phase 1→2 の間はデータが入って未強制の状態なので、**Phase 2 完了までは2社目を本番投入しない**こと。

---

## 5. 認可・JWT 改修ポイント

- JWT: `companyCode` は**既に入っている**ため、案Aなら**改修不要**。案Bを選ぶ場合のみ `org_id` 追加が必要（`jwt.ts` / `login/route.ts` の2か所）。
- `requireAuth()`（`src/server/auth/index.ts`）: ロール検証は現状維持。返す `user.companyCode` をテナントスコープの単一の真実とする。
- 追加で検討: 1ユーザーが複数会社に属する将来要件があるか（運営代行など）。あるなら JWT に「現在選択中の会社」を持たせる設計が要る。**当面は1ユーザー=1会社の前提**で進める。

> 確認したい点: 1ユーザーが複数会社にまたがる運用は当面無い、で良いか。

---

## 6. 未確定・要確認リスト

1. **D1**: テナントキーは案A（company_code据え置き）でよいか／案B（org_id UUID 正規化）にするか。
2. **D3**: `carriers`/`units` は「共有マスタ＋会社別有効化」方針でよいか。
3. **§5**: 1ユーザー=1会社の前提でよいか（複数会社所属は当面無し）。
4. 既存の `companies` 行は現運用の1社のみか。バックフィル時に割り当てるコード値の確定。
5. 旧 `daily_reports`(v1) は今も多くのクエリで直接参照されているか。会社列追加の対象に含めるか。

---

## 7. 次アクション（合意後）

1. 上記 D1〜D3 と §6 を確定。
2. Phase 0/1 のマイグレーション（列追加＋バックフィル＋インデックス）を作成。
3. `src/server/db/tenant.ts` ＋ 既存ローダ改修でスコープ一元化（Phase 2）。
4. テナント越境テストを Vitest に追加（`testing-suite` 参照）。
