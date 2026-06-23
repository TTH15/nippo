# プラットフォーム基盤設計 叩き台（マルチテナント / アイデンティティ / 認証 / オンボーディング）

機能ごとの業務フローは別ファイル（`docs/*-flow.md`、例: `notification-flow.md`）に分離。本書は基盤設計を扱う。

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

## 2. アイデンティティ／所属／テナント識別モデル（確定方針）

### 2-0. アイデンティティと所属の分離（最重要）

「人そのもの」と「どの会社に属するか」を別レイヤにする。

| 層 | 意味 | 個数 | 保持物 |
|---|---|---|---|
| **identity（アイデンティティ）** | 顔・免許・氏名・生年月日で確定する「この人」 | **1人=1つ**（グローバル） | KYC情報・電話・Passkey・LINE連携 |
| **membership（所属）** | どの会社に、どの役割（DRIVER/ADMIN/ADMIN_VIEWER）で属するか | **1人=複数OK** | org_id・role・status・driver_code |

- これにより**複数アカウント問題が消える**：会社が複数でもアカウントは1つ、所属が複数、アプリ内で切替（Slackモデル）。
- 顔・免許で本人確認するので「同一人物=1 identity」を保証でき、二重登録を防げる（=利点）。

**壊さない実装**: 既存 `drivers` 行を**そのまま membership** として温存（既に company_code・role・driver_code を持つ）。新規 `identities` を上に1枚足し、`drivers.identity_id` で紐付け。**既存の `driver_id` 参照（shifts/daily_reports 等）は無改修**。氏名・免許・PIN は identities へ昇格（人単位で重複排除）。

### 2-1. 認証（Passkey ＋ 電話OTP、LINEは通知のみ）

- **ログインの正本は Passkey（WebAuthn）**。パスワード/PIN より安全・フィッシング耐性高。Next.js が Relying Party になり Passkey 検証 → 既存 JWT 発行（構成A、Supabase無関係）。
  - 必要: `@simplewebauthn/server`、iOS/Android の associated domains（`apple-app-site-association`/`assetlinks.json`）、Expo の Passkey ライブラリ。
- **電話番号は SMS OTP で"検証"**（入力のみは不可。緊急連絡手段が誤りだと致命的なため）。identity 層に1つ保持。
  - 唯一の新規外部依存＝**SMSプロバイダ**（Twilio Verify/AWS SNS/国内）＋1通数円の従量課金。
- **LINE はログインに使わない**。通知チャネル専用。**既定 = Nippo公式アカウント1本の統合方式**（詳細 `notification-flow.md` §1）。チャネルは配信パイプにすぎず、誰に/何を/いつ はプラットフォームのテナントスコープが決める。
  - 統合のため LINE連携は **identity単位**（1人1つのuserId）。将来BYO-LINE（自社ブランド希望社）を足すときに `line_links(identity_id, org_id, line_user_id)` の org別へ拡張。
  - 統合チャネルの誤爆防止（org越境送信の禁止）は `notification-flow.md` §1-3 に集約。
- **端末紛失リカバリ**: ①SMS OTP で自己復旧 → 新端末で Passkey 再登録、②運営が顔・免許で本人確認して再登録、の2経路。KYC＋電話＋運営承認が復旧アンカー。
- **メアド/Google等の併設は不要**。消費者アプリがメアドを置く主因は「復旧アンカー」だが、本アプリは検証済み電話＋KYC＋運営承認で既にそれを満たす。SMS OTP は**復旧・再登録専用**（毎回ログインには使わない＝コスト最小・安全最大）。PIN は廃止。Passkey は iCloud/Google 同期で機種変も引継がれるため復旧発動はレア。

### 2-2. アイデンティティ作成 → 会社参加フロー

```
【identity作成（初回1回）】
1. Passkey作成（端末の生体/PIN）= ログイン手段確立
2. 電話番号 → SMS OTP 認証
3. 氏名・生年月日
4. 顔写真撮影
5. 免許証撮影（＋有効期限入力）
6. LINE連携（通知用に公式アカウント友だち追加）

【membership作成（会社ごと・何度でも）】
7. join_code 入力 → org 逆引き → membership を status='pending' で作成
8. 会社の運営画面に「承認待ち」表示（顔・免許を目視確認）
9. 運営が承認 → status='active' で稼働（却下も可）

※ 2社目以降は 7〜9 のみ（1〜6 を再利用）
```

- 顔・免許は**目視確認用の記録のみ（eKYCなし）**。承認ステップ＝本人確認。外部eKYC不要・PII最小。
- 免許有効期限は identity に保存し、期限切れ前にアラート（運用要件）。
- センシティブPII（顔・免許）は identity に1つ持ち、所属会社にのみ承認時に開示。

### 2-3. テナント識別コード

| 役割 | 用途 | 性質 | 例 |
|---|---|---|---|
| **org_id（UUID）** | 内部キー。全テーブルのFK、テナント分離はこれで行う | **不変・人に見せない** | `7f3a…` |
| **join_code（英数6文字）** | 会社参加用の招待コード | **再生成可能**（漏れたら作り直す） | `K7M2QP` |
| 表示コード（legacy company_code） | 運営画面の表札。既存3文字 `ACE` を退避 | 可変・表示専用 | `ACE` |

- 1社=1つの共有 join_code で十分。漏洩時は運営が再生成。承認必須なので漏れても勝手には入れない。

### 2-4. 認可・JWT

- JWT は **`identity_id` ＋ `current_org_id`（選択中の会社）** を持つ。会社切替＝current_org_id を差し替えてトークン再発行（その identity が持つ membership に限る）。
- テナントスコープは `current_org_id`。`user.membershipId` が具体の drivers 行。
- 会社をまたぐ参照権限は JWT に焼き込まず、クエリ時にグラント表（§4）から都度解決（取消が即反映）。

### 2-5. 運営社（会社）オンボーディング ＝ プラットフォーム承認（KYB）

承認は2層: **運営社→プラットフォーム（あなた）承認（KYB）** ／ ドライバー→運営社承認（KYC、§2-2）。運営社の審査＝そこに将来登録される全ドライバーのPIIへのアクセス権を誰に渡すかの門番。**Webフォーム即発行はしない。**

**フロー（ハイタッチ）**
```
1. 申請者が identity 作成（認証方式は仮。まずMagic Link等で申請可能に）
2. 会社情報＋KYB資料: 会社名/法人番号/代表者/所在地/連絡先/請求先
   - 法人番号 → 国税庁API照合（実在/名称/所在地）＋登記事項証明書アップロード（厳格に手動確認）
3. 【導入相談】オンラインで 料金・ログイン方式・初期設定 を決定（必須）
4. 利用規約＋個人情報の委託契約に同意
5. プラットフォームが審査（必要に応じ電話確認）→ 承認
6. organizations を status='active' 発行、join_code採番、決めた認証方式で ADMIN 開通
7. 実ADMIN（社長等）を招待、ドライバー招待開始
※ 承認前は「審査中ダッシュボード」のみ（テナント未発行）。organizations.status = pending/active/suspended。
```

**引き継ぎ・委任は認証を緩めず membership で解く**: 運営者も identity＋ADMIN membership。アカウントを共有/譲渡しない。会社に複数ADMIN membershipをぶら下げ、人の出入りは membership 付与/剥奪で対応（会社・データは残る）。「申請は担当者、実体は社長」は承認後に社長をADMIN招待→担当者降格で対応。

**運営者の認証方式 = org単位で選択（1つに確定しない・§9で未決）**。運営者は最大のPIIにアクセス＝最も狙われるため、引き継ぎ都合で弱い認証にしない。強い順:
| 方式 | 引き継ぎ | セキュリティ | 向く相手 |
|---|---|---|---|
| SSO（Google Workspace/Entra） | ◎ IdP管理 | ◎ | 自社IdPを持つ会社（理想形） |
| Passkey＋メール復旧 | △ 端末依存 | ◎ | IdPなしのモダン企業 |
| メールMagic Link/OTP＋2FA必須 | ○ | ○ | Passkeyが難しい会社 |
| ID＋パスワード単体 | — | ✗ | 採用しない |

→ **決定: 既定=Passkey**（ドライバーと同一の identity 基盤。運営者が現場で配送し日報も出す層がいるため、**1アカウントで連結**が綺麗）。SSOはIdP保有社の任意、メールOTPはPasskey困難社のフォールバック。ID＋パスワード単体は不採用。方式の上書きは導入相談時にorg単位で選択。
- **運営者は現場稼働も可**: identity＋ADMIN/VIEWER membership は配送・日報・チェックインも実行可（既存の「ADMINはDRIVER操作可」階層を踏襲）。同一Passkeyで両方の役割。

**課金**: 公開セルフサーブ価格なし。**エンタープライズ価格**を導入相談で提示。フローは「申請→導入相談（料金/方式/初期設定）→契約→承認・発行」。

**PII・コンプラのガードレール**: ①テナント分離が最大の保護（§2-3,§3）②顔/免許画像は暗号化＋短命署名URL＋テナント＆本人限定 ③運営社内でも免許/顔はADMINのみ・ADMIN_VIEWER不可（最小権限）④PII閲覧の監査ログ（希望休監査の考え方を拡張）⑤退職/解約時の削除ポリシー ⑥法的: 運営社=取扱事業者、あなた=委託先 → 委託契約＋安全管理措置。元請け→下請け共有（§4）は第三者提供論点あり。**契約/規約/個情法対応は専門家レビュー前提**。

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

-- アイデンティティ層（人単位・KYC・認証）※既存driversはmembershipとして温存
CREATE TABLE identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, dob date,
  phone text, phone_verified_at timestamptz,   -- SMS OTPで検証
  face_photo_path text, license_photo_path text, license_expiry date,
  line_user_id text,                            -- 統合Nippo公式の友だち追加で取得（identity単位）
  created_at timestamptz DEFAULT now()
);
-- 将来BYO-LINE（自社ブランド希望社）を足すとき、identityのline_user_idに代えて
-- line_links(identity_id, org_id, line_user_id) のorg別へ拡張。orgチャネル資格情報は暗号化保存。
CREATE TABLE passkey_credentials (              -- WebAuthn
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identities(id),
  credential_id text UNIQUE, public_key bytea, counter bigint,
  created_at timestamptz DEFAULT now()
);
-- drivers 行 = membership。identityへ紐付け＋承認状態
ALTER TABLE drivers ADD COLUMN identity_id uuid REFERENCES identities(id);
ALTER TABLE drivers ADD COLUMN status text NOT NULL DEFAULT 'active'; -- pending/active/rejected
-- 氏名・免許・PIN等の"人"の属性は identities へ昇格（人単位で重複排除）

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
実装の進捗は memory `tenant-migration` を正とする。テナント＝**ACE**（`organizations.code='ACE'`）。

- **Phase 0 — 正式化 ✅完了**（migration 082）: `companies`→`organizations` リネーム（`join_code`/`status` 追加、`code`=display_code）。ACE 行を保証・join_code 採番。
- **Phase 1 — 列追加（nullable）＋バックフィル ✅完了**（migration 083）: §6 の org_id 列を nullable 追加、既存全行を ACE で UPDATE、`org_id` インデックス付与。車両は `owner_org_id`。
- **Phase 2 — 強制の一元化 ✅完了**: `src/server/db/tenant.ts`（`resolveOrgId`/`requireTenant`）新設。
  - 2a: 集計ローダ `loadAggregationData(orgId,…)` ＋給与/請求チェーンを org_id スコープ（daily_reports_v2 / ledger_entries）。
  - 2b-1: daily_reports_v2 の**書き込み**に org_id 刻印＋migration 084 でギャップ再バックフィル（**鉄則: READをスコープしたら同テーブルのWRITE刻印＋再バックフィルをセットで**）。
  - 2b-2: submit_screen_config / courses / events / vehicles(owner_org_id) / oil_change_reports の主要 list/singleton 読みをスコープ＋書き込み刻印。
  - 2c: `shift_request_deadline_*`（`saveRules`/`saveDeadlineOverrides` の**無スコープ全削除という地雷**を当org分のみ削除へ。子は rule_id 経由で限定）。
  - 2d: 手書き `.eq("company_code")` 約50箇所→`.eq("org_id", orgId)` 置換＋書き込み刻印（migration 085 で請求系4表に org_id 追加が前提）。残った `.eq("company_code")` はログインの表示コード照合のみ。
  - 仕上げ: `[id]` ルートの **PK指定のみ mutation（UPDATE/DELETE）に org_id ガード**（cross-tenant 破壊の IDOR を塞ぐ）。
- **Phase 3 — 制約強化 ✅完了**（migration 086）: 全 org_id 列（＋vehicles.owner_org_id）に NULL→ACE 再バックフィル→FK→NOT NULL（単一冪等 DO ブロック）。全書き込みが org_id を刻むことを事前監査（スクリプトも刻印）。
- **Phase 4 — キャリアの会社別化 ✅完了**（migration 087）: `company_carriers(org_id, carrier_id)`＝共有マスタ＋会社別有効化。ACE 全有効 backfill。集計ローダ・admin/carriers・submit-screen の carrier/unit 読みを org スコープ（`loadOrgCarrierIds`、未設定は全許可フォールバック）。carrier 作成は当org有効化、by-id mutation は `orgOwnsCarrier` でガード。**YAMATO/AMAZON 残ハードコード（旧V1 submit `SubmitPageClient`/`api/reports`、請求セクション Amazon/ヤマト/郵便局）は ACE 固有で multi-tenant 非必須 → 対象外（合意）**。運営日報UIの動的化は別途完了済（`admin-daily-legacy-display`）。
- **Phase 5a — identity層抽出 ✅完了**（migration 088）: `identities`/`passkey_credentials` 作成。`drivers` に `identity_id`(FK)・`status`(default active, CHECK pending/active/rejected) を追加。既存 drivers を 1:1 で identity へ backfill（氏名・電話・免許・LINE・PIN を人単位の属性として移送＝冪等）。**追加のみ・挙動不変**（読み書きの正本は drivers のまま。読み替え/Passkey は Phase 6）。driver 作成パス（admin/users POST＋seedスクリプト）で identity も作成し「driver は必ず identity を持つ」不変条件を維持。**属性の判断基準＝「同じ人が A社・B社でも同一の値か」→ YES=identity（本名/電話/免許/顔写真/PIN/LINE）、NO=membership(drivers)（会社内表示名/役割/driver_code/銀行口座/請求住所/status）**。
- **Phase 6a — JWT identity 化 ✅完了**（コードのみ・migration なし）: `signToken`/`verify` と `AuthUser` に `identityId`＋`orgId`(current_org_id) を**後方互換で追加**（旧トークンは null フォールバック・既存30dセッション無効化なし＝ドライバー側変化ゼロ）。ログイン2経路（driver/admin）が drivers.identity_id/org_id を JWT に刻む。**orgId 解決の権威は当面 DB（`resolveOrgId`、約50ルートが直接利用）のまま据え置き**＝会社切替で token を権威に切替えるのは実装時。jwt 往復・後方互換テスト4本追加。
- **Phase 6b〜 — 認証刷新 ⬜️未着手**: Passkey(WebAuthn) 導入（**rpID＝本番ルートドメインに固定**＝Web 登録分をネイティブで再利用可。associated domains 同ドメイン）、電話 SMS OTP 検証、LINE連携。会社切替UI（current_org_id 差し替え＋token 再発行→ここで requireTenant を token 権威に切替）。**移行戦略=ネイティブ公開まで PWA で Passkey 任意登録・KYC・LINE を前倒し収集**（memory tenant-migration 参照）。
- **Phase 7 — 参加フロー ⬜️未着手**: join_code 入力API・承認/却下API・`status` 運用を実装。
- **Phase 8 — 隔離テスト ✅基盤完了**: 実DB(Supabase ブランチ)に supabase-js で接続する env-gated 統合テスト（`npm run test:itest`、`*.itest.ts`）。使い捨て2 org を seed し集計/ledger/mutation の隔離を assert。ルートレベル(JWT+NextRequest)テストは follow-up。

各 Phase は独立リリース可。**Phase 2 完了まで2社目を本番投入しない**条件はクリア済（org_id 基盤・スコープ・制約・キャリア別化・隔離テストまで完了＝技術的に2社目を載せられる土台）。残りは認証/参加フロー（Phase 5-7）。

---

## 8. 保留（実需が出てから・土台は確保済み）

- **複数所属（会社切替UI）**: identity/membership 分離は最初から作る（土台）。ただし2社目を実際に運用する会社切替UI・複数membershipの本番運用は実需が出てから。`driver_identities`(2スロット) は勤務区分用で別概念。
- **元請け→下請けのコース共有**（§4）: `course_shares`／外部エクスポート／コース別名。
- **車両の会社間貸借UX**（§5）: 借用org可視化・スコープ絞り。
- **company_code→org_id の完全廃止**: 当面 display_code として共存。
- **identityの自動重複検出**（同一免許/同一人物のマージ）: 当面は手動。eKYC自動照合はしない。

---

## 9. 未確定・要確認

1. `carriers`/`units` は「共有マスタ＋会社別有効化」でよいか。
2. 既存 `companies` 行は現運用1社のみか。バックフィル時の org_id 確定。
3. 旧 `daily_reports`(v1) は今も直接参照が多いか。org_id 追加対象に含めるか。
4. ドライバーの `status` 既定値: 既存ドライバーは 'active' で移行、新規参加のみ 'pending'。
5. ~~運営者の認証方式~~ → **決定: 既定Passkey（ドライバーと同一identity・運営兼配送者を1アカウント連結）、SSOはIdP保有社の任意、メールOTPフォールバック**。org単位で上書き可。
6. **課金（§2-5）**: **ドライバー1人/月の席課金（Workspace的、例¥1,000/人）**＋導入相談で確定。具体の価格表・契約フローは未確定。
7. 申請者と実ADMIN（社長等）の分離運用: 申請者を一時ロールにするか、ADMIN付与後に社長招待→降格か。

---

## 10. 次アクション（合意後）

1. §9 を確定。
2. Phase 0/1 マイグレーション（organizations整備＋org_id列＋バックフィル＋インデックス）作成。
3. `src/server/db/tenant.ts` ＋ 既存ローダ改修でスコープ一元化（Phase 2）。
4. テナント越境テストを Vitest に追加（`testing-suite` 参照）。
