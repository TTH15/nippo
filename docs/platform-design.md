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

**保存／開示／確認の3分離（複数所属での個情法対応）★合意済み・実装これから**。PII を identity に1つ持つ（保存）こと自体は委託先としての預かりで問題ないが、**org をまたぐ自動可視化＝第三者提供**になる。そこで3つを別管理にする:

| 関心 | 置き場所 | 単位 | 状態 |
|---|---|---|---|
| 保存（写真・期限の正本） | `identities` | 人 | ✅ ある（更新は1回で済む） |
| **開示同意（この org に見せてよい）** | 新規 `pii_disclosures` | identity × org | ❌ 無い（現状 membership 存在で暗黙開示） |
| 本人確認（目視承認した） | `drivers.kyc_verified_at` | membership | ✅ あるが再検証フック無し |

```sql
CREATE TABLE pii_disclosures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id   uuid NOT NULL REFERENCES identities(id),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  document_kind text NOT NULL CHECK (document_kind IN ('license','face')),
  consented_at  timestamptz NOT NULL DEFAULT now(),
  consent_source text,                  -- 'join_wizard' 等（監査用）
  revoked_at    timestamptz
);
CREATE UNIQUE INDEX uq_pii_disclosure_active
  ON pii_disclosures (identity_id, org_id, document_kind) WHERE revoked_at IS NULL;
```

- `kyc/route.ts` は role（§2-6 `can_view_pii`）に加え **当 org×identity に有効な開示同意があるときだけ署名URLを返す**＋PII閲覧監査ログ。
- **2社目参加**: 写真は再アップロード不要。ウィザードで「登録済みの免許/顔を ○○社に提出しますか？[このまま提出/撮り直す]」と聞き、開示同意を作る（＝本人同意の記録）。
- **免許更新**: identity を1回更新→開示同意は維持（再提出不要）。ただし各 membership の `kyc_verified_at` をクリアし「再確認待ち」に戻す（各社が新証跡を目視し直す＝再アップロードは不要）。
- **退職/解約**: 当 org の開示同意を `revoked_at` で取消→即不可視。identity の写真は他社向けに残る。
- 法的分類（同種書類の更新が同意でカバーされるか等）は**専門家レビュー前提**。

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

### 2-6. 認可モデル（capability / role / permission）★合意済み・実装これから

権限も §2-0 と同じ「束ねる単位を分ける」思想で3層にする。現状は単一 role（DRIVER/ADMIN/ADMIN_VIEWER）を `requireAuth` の3段ハードコード階層で約163ルートに直書きしており、**読み/書きの区別は「ADMIN_VIEWER=読取専用 vs ADMIN=書込」だけ・全画面一律・運営は変更不可**。これをドメイン能力単位に作り替える。

| 層 | 意味 | 個数 | 可変性 |
|---|---|---|---|
| **capability（権限の最小単位）** | `can_view_rewards` 等、コードが知る固定の能力 | **固定（~15）** | コード変更時のみ |
| **role（権限の束）** | capability の集合に名前を付けたもの | **org ごとに自由** | **org が作成・編集・並べ替え** |
| **membership の role 割当** | その人がどの role か（既存 `drivers.role` を昇格） | 1 membership = 1 role | 運営が付与 |

- **粒度は「管理画面の read/write」ではなくドメイン能力**（`can_view_rewards` / `can_view_bank_accounts` / `can_manage_shifts` …）。UI 単位でなく業務単位なので、運営の設定 UI がチェックボックスで素直。
- **role は org 単位で自由に作れる**（GitHub のカスタムロール型）。system 既定（DRIVER/ADMIN/ADMIN_VIEWER/ACCOUNTING）を seed しつつ、org が独自 role（例「経理主任」「副管理者」）を capability を盛り合わせて新規作成し、`sort_order` で並べ替えできる。
- **capability は org が増やせない**（コードの固定集合）。各 `can_*` が1つのサーバーガードに対応するので、新 capability＝コード追加。これで「ガードの無い権限名」が生まれず取りこぼしを防ぐ。

**capability カタログ（初版・~15）**。○=既定で付与。

| capability | 意味 | DRIVER | ACCOUNTING | ADMIN_VIEWER | ADMIN |
|---|---|:-:|:-:|:-:|:-:|
| `can_view_reports` | 全員の日報を閲覧 | ✕ | ○ | ○ | ○ |
| `can_edit_reports` | 代理入力・修正 | ✕ | ✕ | ✕ | ○ |
| `can_view_shifts` | シフト表の閲覧 | ✕ | ○ | ○ | ○ |
| `can_manage_shifts` | シフト確定・希望休管理 | ✕ | ✕ | ✕ | ○ |
| `can_view_rewards` | 報酬・給与の閲覧 | ✕ | ○ | ○ | ○ |
| `can_manage_rewards` | 単価設定・給与締め | ✕ | ○ | ✕ | ○ |
| `can_view_bank_accounts` | 口座情報の閲覧 | ✕ | ○ | ✕ | ○ |
| `can_view_pii` | 顔・免許の閲覧 | ✕ | ✕ | ✕ | ○ |
| `can_view_vehicles` | 車両情報の閲覧 | ✕ | ○ | ○ | ○ |
| `can_manage_vehicles` | 車両の登録・管理 | ✕ | ✕ | ✕ | ○ |
| `can_view_billing` | 請求・取引先の閲覧 | ✕ | ○ | ○ | ○ |
| `can_manage_billing` | 請求の確定・取引先編集 | ✕ | ○ | ✕ | ○ |
| `can_approve_members` | 参加承認・本人確認 | ✕ | ✕ | ✕ | ○ |
| `can_manage_members` | ロール変更・退会処理 | ✕ | ✕ | ✕ | ○ |
| `can_manage_org_settings` | フォーム/締切/コース等の設定 | ✕ | ✕ | ✕ | ○ |

view/manage を分けるのは機微なドメイン（rewards/bank/pii/billing/members）だけにして個数を抑える。追加候補: `can_export_reports`（元請け共有・§4）、`can_send_notifications`（通知送信）。

**スキーマ**
```sql
CREATE TABLE roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id),
  key        text NOT NULL,             -- 'ADMIN' 等。system は予約キー
  label      text NOT NULL,             -- 表示名（org が自由に）
  is_system  boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,    -- 表示・優先順位（運営が並べ替え）
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);
CREATE TABLE role_capabilities (
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability text NOT NULL,             -- 'can_view_rewards' 等（コード固定集合）
  PRIMARY KEY (role_id, capability)
);
-- membership は role を参照（既存 drivers.role[text] を role_id[FK] へ移行）
ALTER TABLE drivers ADD COLUMN role_id uuid REFERENCES roles(id);
```

- **移行**: 各 org に system 既定 role 4種＋既定 capability を seed → 既存 `drivers.role`(text) を対応する `role_id` にバックフィル → `drivers_role_check` 撤廃。`drivers.role`(text) は当面併存（表示・互換）。
- **ガード**: ルートは `requirePermission(req, "can_view_rewards")`。解決は `membership.role_id → role_capabilities`。機微系（`can_view_pii`/`can_view_bank_accounts`/`can_manage_rewards`）は**都度 DB 解決（取消即時）**、軽量系は JWT にキャッシュ可。既存の3段ハードコード（約163か所）は**機微なものから段階置換**。
- **§2-2 PII と連動**: `can_view_pii` は org 内の最小権限ゲート。これに加え、人をまたぐ開示は §2-2 の開示同意（identity×org）で二重にゲートする（「org 内の誰が見られるか＝capability」「その org に見せてよいか＝開示同意」）。
- **`features` と別レイヤ**: `organizations.features`（機能ON/OFF）は「その機能が有効か」、capability は「有効な機能を誰が使えるか」。混同しない。
- ⚠️ **`ACCOUNTING`（migration 091 で DB CHECK に追加済）は JWT verify ホワイトリスト・型に未反映**＝現状ログイン不可。本フェーズの role 化で同時に解消する。

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
- **Phase 6b — Passkey(WebAuthn) ✅完了**（2026-07-09、migration 102、コード：`server/auth/webauthn.ts`・`api/auth/webauthn/{register,login}/{options,verify}`）: rpID＝本番ルートドメイン `hakotora.jp` に固定（Vercel Production環境変数 `WEBAUTHN_RP_ID`/`NEXT_PUBLIC_WEBAUTHN_RP_ID` 設定済み・2026-07-11確認）。ドライバー(`me/page.tsx`)・運営(`admin/account`, 各 portal-*/login)双方に登録・ログインUI実装済み。`useIsWebAuthnHost()` でrpIDとホスト不一致時はUIを安全に非表示化。電話 SMS OTP 検証も同時期に完了（下記「仮登録の SMS OTP」参照、復旧アンカーとしても機能）。
  - **残り（未着手）**: LINE連携（別トラック M3）。**会社切替UI**（current_org_id 差し替え＋token再発行）＝複数org所属者向けの選択UI。現状は `resolveActiveDriverByIdentity` が複数所属を検出すると Passkeyログイン/電話復旧どちらも 409 で弾き、「PINでログインしてください」「運営にお問い合わせください」という安全なフォールバックメッセージを返す設計（`api/auth/webauthn/login/verify/route.ts`・`api/auth/recover/verify/route.ts`）。実際に複数org所属を持つ人が現状いないため実害はなく、優先度低として一旦保留（2026-07-11判断）。
- **Phase 7a — 参加フロー（backend）✅完了**（コードのみ・migration なし）: 公開 `POST /api/join`（join_code→active org 逆引き→identity＋drivers を `status='pending'` で作成・driver_code/PIN は付けない＝承認時発行・同 org 同 phone の多重申請抑止）。ログインに **membership status 適用**（active 以外は 403、pending=承認待ち/rejected=利用不可。既存全行 active＝挙動不変）。`POST/GET /api/admin/join-code`（再生成・曖昧文字除外6文字 `generateJoinCode`・一意リトライ）。`GET /api/admin/users?status=`（既定 active で既存ロスター不変、pending で承認待ち一覧）。`PUT /api/admin/users/[id]` が `status`(active/rejected) を受け、承認時に driver_code 割当で初期PINを発行（pin_hash 未設定時のみ）。検証=tsc clean・248緑（joinCode 単体4＋既存）。join flow の DB 不変条件 itest（env-gated）追加。
- **Phase 7b — 参加フロー（UI）✅完了**（コードのみ）: 公開 `/join` ページ（参加コード＋氏名＋電話で申請→承認待ち、ログイン雛形流用・認証不要）。運営「参加・承認」ページ `/admin/users/pending`（join_code 表示/再生成＋承認待ち一覧＋承認モーダル[driver番号/事業所/コース→PUT status:active で driver_code・初期PIN発行]＋却下[PUT status:rejected]）。AdminLayout の「管理」に導線追加。**1175行の users 本体は無改修**（リスク回避で専用ページ化）。検証=tsc clean・248緑。
- **仮登録の SMS OTP ✅完了**（コードのみ・Twilio Verify）: `POST /api/otp/send`／`GET /api/join/lookup`（会社名のみ）。`POST /api/join` を OTP 必須化（`checkOtp` approved 確認→identity を**検証済み電話で find-or-create**＋`phone_verified_at` 刻印→pending）。admin pending 一覧は電話を**下4桁マスク**（誤 join_code でもフル電話を渡さない）。mobile `RegisterScreen`＋web `/join` を 3ステップ（コード→会社名確認→氏名/電話→OTP→申請）に。
- **本登録 KYC ✅完了**（migration 089=非公開バケット `kyc-documents`）: 承認後ドライバーが免許/顔写真＋住所/銀行＋免許期限を登録。`server/kyc/storage.ts`（upload/署名URL）／`GET・POST /api/me/registration`（部分更新・`complete` 判定）／`POST /api/me/registration/photo`（base64→Storage→identities にパス）。mobile `KycWizard`（進捗バー＋ステップ：免許写真＋期限→顔写真→住所→銀行）。住所/銀行=membership、免許/顔=identity。
- **2段階承認（本人確認）✅完了**（migration 090=`drivers.kyc_verified_at`/`kyc_verified_by`）: プライバシーで仮登録を最小化した副作用＝「承認=顔/免許の目視確認」（§2-2）を是正。**仮承認(pending→active)→本登録→本承認(運営が顔/免許を目視)→アプリ解放**。`GET /api/admin/users?stage=kyc`（本人確認待ち）／`GET /[id]/kyc`（免許/顔の署名URL・ADMIN/VIEWERのみ）／`POST /[id]/verify-kyc`（approve→kyc_verified_at / reject）。admin `/admin/users/pending` に本人確認待ちセクション＋KYCレビューモーダル。mobile ハードゲート3状態（本登録未完→ウィザード／本承認前→KycPending待機／本承認済→タブ）。
- **免許期限 OCR ✅完了**（コードのみ）: `core/logic/license.ts` `parseLicenseExpiryFromOcr`（純粋・和暦/西暦・括弧併記対応・「まで有効」優先）＋テスト。mobile は端末側 ML Kit（`@react-native-ml-kit/text-recognition`・和文・画像は端末から出ない）で免許写真→期限プリフィル→**ユーザー確認**。読めなければ手入力。
- **dev 環境＋mobile アプリ ✅基盤**: 独立 dev Supabase＋`npm run db:migrate`（台帳方式 `_migrations`）。`apps/mobile`（Expo SDK52・React18.3・`@repo/core` 再利用）＝ログイン/仮登録/本登録/日報/希望休/報酬/マイページの全画面を実装し **NativeWind** に統一。実機ビルド・SMS・OCR は実機で確認。詳細は memory `tenant-migration`/`rn-migration-core-layer`。
- **Phase 8 — 隔離テスト ✅基盤完了**: 実DB(Supabase ブランチ)に supabase-js で接続する env-gated 統合テスト（`npm run test:itest`、`*.itest.ts`）。使い捨て2 org を seed し集計/ledger/mutation の隔離を assert。ルートレベル(JWT+NextRequest)テストは follow-up。

- **Phase 5b — 整合性制約 ✅完了**（migration 091）: identity/membership の不変条件をDB化。`identities(phone)` 検証済み部分ユニーク（1人=1 identity）／`drivers(identity_id, org_id)` 却下以外で部分ユニーク（1人×1社=1所属）／`drivers.role` に `ACCOUNTING` 追加。対の `api/join/route.ts` を find-or-create 冪等化（複数行で壊れない・並行/再送の 23505 を「申請済み」に吸収）。検証=tsc clean・258緑。

- **Phase 9 — 基盤の作り込み（設計合意済・実装これから）**: 以下は複数所属の本番運用に必要で、相互に絡む。
  - **認可モデル（§2-6）**: `roles`/`role_capabilities` 追加＋`drivers.role_id` 移行。`requirePermission(cap)` 導入し約163か所の3段ハードコードを機微順に置換。system 既定 role を seed。`ACCOUNTING` を JWT/`requireAuth` に通す（091 の置き土産解消）。
  - **PII 開示同意（§2-2）**: `pii_disclosures` 追加。`kyc/route.ts` を `can_view_pii`＋開示同意の二重ゲート＋監査ログに。2社目参加ウィザードの開示同意・免許更新時の `kyc_verified_at` クリア。
  - **承認ステートマシン**: membership の状態（`status` + `kyc_verified_at` + 導出 `complete`）を1列の明示遷移（pending→approved→kyc_submitted→verified→suspended 等）に集約。
  - **invites（招待エンティティ）**: `organizations.join_code` 1個に潰れている招待を独立化（token/kind=url|qr|code・role・expires_at・max_uses・revoked_at）。join_code は「無期限 open invite」の1特殊行として内包。

各 Phase は独立リリース可。**Phase 2 完了まで2社目を本番投入しない**条件はクリア済（org_id 基盤・スコープ・制約・キャリア別化・隔離テストまで完了＝技術的に2社目を載せられる土台）。認証（Phase 6b）もPasskey/SMS OTPまで完了。残りは会社切替UI（複数org選択）・LINE連携・Phase 9 の基盤作り込み。

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
8. ~~権限の粒度・role 設計~~ → **決定: capability（固定~15の `can_*`）＋ org が自由に作れる role（capability の束・`sort_order`）。粒度はドメイン能力単位（管理画面 read/write ではない）。ユーザー個別 ACL は作らない（§2-6）**。

---

## 10. 完成 → ストア申請 までのロードマップ（2026-06-24 合意）

現状: マルチテナント基盤（org_id, 082-087）は**本番(ACE)反映済み**。identity/membership/KYC/参加(OTP)/認可(roles・capabilities)＝migration 088-094 と mobile(Expo)一式は **dev＋feat ブランチのみ**で、本番未反映。認証は移行用 PIN/パスワードのまま。

### 最重要のゲート（直列）
**ブランド/サービス名・ドメイン確定 → Passkey(6b) → 本番カットオーバー（大型マージ）**
- "Nippo" は商標の都合で改名予定 → ドメイン変更 → WebAuthn の **rpID は登録ドメインに固定**が前提のため、Passkey はドメイン確定後でないと着手すると登録が無効化される。
- よって **identity/KYC/認可の大型マージは Passkey ができてから**（合意）。それまで本番は現行のまま無傷で稼働。

### いま進められる（ブランド非依存・dev/feat 上で並行可）
- **QR 出勤→退勤 業務フロー**（vehicle-session 新トラック）: QR は `vehicles.id`(UUID) を指す。チェックイン/アウト・メーター記録。`docs/vehicle-session-flow.md`。ブランド非依存。
- **プッシュ通知**: dev では Expo push で試作可。**本番配信は最終 bundleID＋APNs/FCM（＝ブランド/ストア確定）に依存**するため、基盤試作は今・本番設定は後。LINE 通知（統合公式）とは別レイヤ（`notification-flow.md`）。
- **UI 細部修正**: 随時。ただし**ブランド準拠の最終仕上げ（色/ロゴ/名称）はブランド確定後**にもう一段。
- 残りの mobile 画面の作り込み。
- ※これらは新プラットフォーム線（feat）に積み上がり、本番へは下記カットオーバーで一括反映される（QR/通知は identity/membership 前提のため本番へ単独先行はしない）。

### ブランド確定後
- **Passkey(6b)**: Web で任意登録（rpID=本番ルートドメイン固定）→ ネイティブで再利用（associated domains 同ドメイン）。SMS OTP 復旧、LINE 連携。**ログイン統合**（driver/admin の2フォームを1つに＝認証は identity 単位、UI は capability で出し分け。§2-6）。

### 本番カットオーバー（大型マージ）
1. 本番 Supabase(ACE) に **migration 088→094 を順次適用**（手動。**091 の重複事前検査が本番データで発火しうる**＝dev と同様、要事前確認。086/091/094 が制約系）。本番 `_migrations` 台帳でどこまで当たっているか先に確認。
2. **ACE の挙動差分を確認・調整**: ADMIN_VIEWER のシフト編集/承認権限の喪失、口座ゲート等 → 必要なら `/admin/roles` で capability を付与。
3. **安全デプロイ手順**（[[safe-deploy-procedure]]）: ブランチ→push→PR→Vercel preview で確認→main マージ→自動デプロイ。RootDir=apps/web は設定済み。

### ストア申請（ネイティブ公開）
- 最終 bundleID・アプリ名/アイコン/スプラッシュ（ブランド）・APNs/FCM（push）。EAS build → TestFlight/内部テスト → ストア審査 → 申請。
- ネイティブ公開は web/PWA カットオーバーとは別パイプライン（後日）。

### 並行して随時OK（大型マージと独立）
- **本番 web の小修正**: `main` から短命ブランチを切る → PR → preview → merge。進行中の大型作業と切り離して即反映可。

実装の進捗追跡は memory `tenant-migration` を正とする。
