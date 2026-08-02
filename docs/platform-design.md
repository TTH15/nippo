# プラットフォーム基盤設計 叩き台（マルチテナント / アイデンティティ / 認証 / オンボーディング）

機能ごとの業務フローは別ファイル（`docs/*-flow.md`、例: `notification-flow.md`）に分離。本書は基盤設計を扱う。

ステータス: ドラフト（合意形成中）／最終更新: 2026-07-24（§2-1a 初期登録・認証フロー確定）
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

### 2-1a. 初期登録・認証フロー（確定 2026-07-24）

§2-1/§2-2 の方針を具体化し、初期登録と認証を確定した。**本節が実装の正本**（§2-2 の6ステップは初期の概念整理で、順序・手段は本節が優先）。決定は 2026-07-24 のセッションでユーザーと合意。

**認証スタック（3層。ユーザーは常に「FaceID」1つに見える）**

| 場面 | 手段 | 実装 |
|---|---|---|
| アカウント認証（初回ログイン・機種変・30日失効後の再ログイン） | **Passkey**（内部で OS 純正の生体＝FaceID/TouchID が鍵を解錠） | WebAuthn（`server/auth/webauthn.ts`） |
| 毎日のアプリ起動（セッションは SecureStore に30日） | **ローカル生体ロック**（サーバー往復なし・LINE 的な即 FaceID） | `expo-local-authentication` |
| ブートストラップ／端末紛失リカバリ（新端末に Passkey がまだ無い時） | **電話 SMS OTP**（1回もの・毎回ログインには使わない） | Twilio Verify（`api/auth/recover/verify` を転用） |

- **PIN は完全撤廃**（現行の driver_code＋6桁PIN、承認時の初期PIN発行を廃止）。6桁PINは弱く、OTP が復旧を兼ねるため不要。
- **メール（メアド）は採用しない**。「Passkey 非対応端末で web 登録 → mobile ログイン」も含め、耐久識別子で本人性を示す役割は**電話 OTP が完全に同一**。配送ドライバー層では email より電話の方が確実。email を足すと PII 増・到達性インフラ・メール乗っ取りの攻撃面が増え「PII最小」を崩す。SMS 不達のエッジは運営の手動再確認で受ける。

**登録フロー（web 一本化・アプリは稼働専用。2026-07-25 一本ウィザード化＋承認1回統合）**

```
━━━ モバイルブラウザ（インストール不要・1セッションで完結）━━━━
① 単回招待リンク(/join?invite=token) を開く → ようこそ（会社名確認）
   ＋ 利用規約・プライバシーポリシーに同意（/terms・/privacy、チェック必須）
   （予備: 共有参加コード ?code= / 手入力）
② 氏名 → 生年月日 → 電話番号 → SMS OTP
   （検証成功で申請 pending 作成＋pending のままセッション発行＋招待を消費
     ＋同意日時を identities.terms_agreed_at に記録＝migration 115）
③ Face ID（Passkey）を有効にする（任意・スキップ可・あとで /me から可）
④ web KYC: 免許 正面＋期限 → 顔 → 住所 → 申請完了
   （完了画面でアプリ導入を予告。口座以外の PII 収集はここまでで済み）
                    （運営: KYC の揃った申請を1回で承認
                      ＝ driver_code 割当＋active 化＋kyc_verified_at）
━━━ アプリ（承認後・稼働開始のタイミングで導入）━━━━━━━━━━
⑤ 同期済 Passkey または電話OTPでログイン ＋ ローカル生体ロック
⑥ QR業務 / 日報 / シフト / 報酬
```

- 境界は明快: **web＝登録・審査（PII収集まで全部）／ アプリ＝実稼働だけ**。install 前に最低限の PII を集めきれる（＝install 摩擦での離脱前に台帳が完成する）。
- **モバイルの登録/KYC 画面（`RegisterScreen`/`KycWizard`）は退役**し web に一本化（二重メンテ回避）。ML Kit の免許 OCR は業務フロー（安全確認の抜き打ち免許確認・オドメーター）に残るので損失なし。
- **pending セッション**: SMS 検証済みの申請者に発行する JWT は通常形式（requireAuth を通る）。本人系ルート（/api/me/*）で本登録を完結させるためのもので、稼働系の解放は従来どおり status='active'＋kyc_verified_at を見る各ルートがゲートする。招待コード＋SMS 検証が入口ゲートを兼ねる。
- **中断再開**: 招待リンクを開き直す→同じ電話番号で SMS 認証→既存 membership を検出（alreadyApplied）してセッション再発行→未完の KYC ステップへジャンプ。セッションが残っていればコード入力もスキップ。

**招待リンク**

- **主経路は単回招待リンク**（2026-07-25 実装）: `invites` テーブル（migration 114。token unique・宛先メモ・7日期限・revoked/used 管理）＋ `/join?invite=<token>`。運営は承認画面から宛先メモ（任意・管理用ラベル）を添えて発行し、LINE/SMS で個別送付。消費は「used_at IS NULL の条件付き UPDATE」で1回きりを保証（申請済みの再開はトークンを消費しない）。**氏名のプリフィルはしない**＝氏名・生年月日等の PII は必ず登録者本人が入力する（運営入力の伝聞情報を台帳に混ぜない・2026-07-26）。
- 共有 `join_code` の `?code=` 付き URL ＋ QR（open invite）は**口頭伝達フォールバック**として併存。既存 backend（§2-3）は不変。
- **deferred deep linking（Branch 等の外部 SDK）は不要**。web 先行で「招待 → オンボーディング」が全てブラウザ内で完結し、途中に App Store インストールを挟まないため、招待コンテキストがストアを跨いで生き残る必要がない。コードは招待メッセージにも併記し、確実に手入力/貼付できるようにする。
- **承認は1回に統合**（2026-07-25。旧: 仮承認→本承認の2段階）。申請者が KYC まで一気に提出してくるため、運営は承認モーダルで免許・顔を目視し、**1回の承認で active 化＋本人確認（kyc_verified_at）を同時に行う**。入口ゲートは招待コード＋SMS 検証が担う。KYC 未提出のまま承認した場合や既存ドライバーの移行は、従来どおり「本人確認待ち」リスト（verify-kyc）で後から本承認する。稼働解放は本人確認完了が唯一のゲートである点は不変。
- targeted single-use invite は §7 Phase 9 案から**前倒しで実装済み**（2026-07-25）。「仮承認の自動化」は承認1回統合により概念ごと不要になった。

**マイナ免許証・IC チップ読み取り（将来メモ・2026-07-26）**

- マイナ免許証（2025-03 開始）や従来免許証の IC チップを NFC で読めれば、氏名・住所・期限の転記ミスと偽造リスクを同時に潰せるが、**web では実質不可能**（Web NFC は Android Chrome のみ・iOS Safari 非対応）。やるならモバイルアプリ（CoreNFC / Android NFC）＋読み取り SDK（eKYC ベンダー提供・有料）で、8/8 のネイティブ再開後の検討事項。
- 現状の運営目視承認モデルでは費用対効果が薄く、犯収法相当の要件が実需になった時点で eKYC SDK ごと再評価する（§KYC 収集範囲の「後段昇格」方針と同じ）。
- 氏名・住所の OCR 転記は不採用: 氏名入力がフローの先頭（免許撮影より前）にあり順序が合わない上、漢字氏名の OCR 精度は低く「本人入力が正」の原則にも反する。期限のみ OCR プリフィル（実装済み）。

**deep link / Universal Links の要否**

- **招待には不要**。AASA（`webcredentials`）／assetlinks.json（`get_login_creds`）は **ネイティブ Passkey のために M1（8/8 法人登記→Apple Developer 後）で必須**。Universal Links / App Links は同ファイルの副産物として付いてくるだけで、UL routing を先行実装する必要はない。**web 版 Passkey は現状で使用可**（rpID `hakotora.jp` 本番デプロイ済）。

**KYC の収集範囲（eKYC なし・目視承認）**

- **免許証 正面 ＋ 顔写真（自撮り）＋ 住所**のみ。撮影は `<input type="file" accept="image/*" capture>`、保存は既存 `POST /api/me/registration/photo`（非公開 Storage・base64）をそのまま流用。
- **住所は手入力**（「運転免許証の記載どおり」の案内付き）。web での免許 OCR 自動入力は新規外部依存（サーバ側 OCR API）になるため導入せず、正確性は運営が承認時に免許画像と突き合わせる目視で担保。ML Kit OCR（mobile）は業務フロー用に温存。
- **利用規約・プライバシーポリシー**: `/terms`・`/privacy`（ドラフト・法人登記後にリーガルレビューで確定）。ようこそ画面のチェック必須＋ `/api/join` で `termsAgreed` 必須、同意日時は identity 単位で `identities.terms_agreed_at` に記録（再同意で上書き）。
- **業務委託契約（将来・org 設定制）**: org の設定により、KYC 提出後〜申請確定前に**電子契約ステップ**を挿入できるようにする。「要点（画面で読める要約）」と契約書 PDF を分けて提示し、同意ログ（契約書バージョン・同意日時・identity/membership）を記録する。org ごとに契約書テンプレートが異なる前提。実装時期は運用開始後の実需に合わせる（2026-07-26 メモ）。
- **口座はオンボーディングから除外**（2026-07-25）: 本登録の complete 条件に含めず、**初回の報酬支払いまでにアプリのマイページ（MeScreen 振込口座セクション）で登録**してもらう。申請時の摩擦を減らし、口座 PII の収集を実需（支払い）の直前まで遅延させる。API は従来の `POST /api/me/registration`（部分更新）をそのまま使用。
- **免許裏面は撤廃**。有効性・氏名・顔・期限・種別・条件は表面で完結し、住所は別フォームで自己申告するため裏面の住所裏書きは不要。裏面の臓器提供意思は要配慮個人情報で、不採取が「PII最小」に適合。実需（大口取引先の犯収法相当要求）が出たら org 任意で昇格。
- **有効期限は web で OCR プリフィル**（2026-07-26 実装）: 免許写真の撮影直後に tesseract.js（クライアント完結・動的ロード・サーバ送信なし）で読み取り、年月日ホイールへ自動入力。西暦/和暦（令和・平成・元年）両対応、「まで」文脈と日付範囲で交付日・生年月日を除外（`lib/ocr/parseLicenseExpiry` にテストあり）。読めない・範囲外は黙って手入力のまま＝OCR は任意強化で正はあくまで本人入力＋運営目視。
- カーシェア等の「正面＋斜め＋裏面＋liveness＋顔照合」は**犯収法 eKYC（有料 SDK）**で、hakotora の**運営目視承認モデルでは不採用**。斜め撮影/liveness は自動スプーフィング対策で、人が目視する本モデルには不要。

**モバイルのログイン画面**

```
[FaceIDでログイン]        ← 主：同期/端末内 Passkey（8/8 以降フル機能）
[別の方法（電話番号）]     ← 副：電話OTP
   └─ 成功 → 「この端末にFaceIDを設定しますか？」→ Passkey登録
```

- OTP は**恒久の新端末/紛失リカバリ経路**（設計が元から要求）であり、**8/8 前はネイティブ Passkey が使えないため暫定の主役も兼ねる**（二重の必要性・捨て仕事にならない）。現代アプリ定番の「主 Passkey ＋ 別の方法で OTP ＋ 成功後に生体登録」そのまま。

**実装インパクト（現行との差分）**

- **撤廃**: PIN（driver login の driver_code＋PIN、承認時の初期PIN発行）／モバイル `RegisterScreen`・`KycWizard`。
- **新規**: web KYC UI（1画面）／モバイル OTP ログイン画面／モバイル ローカル生体ロック／招待リンク（`?code=` プリフィル＋QR）。
- **転用**: `api/auth/recover/verify`（電話 OTP → セッション発行）を「復旧」から「初回ログイン」にも。
- **依存**: ネイティブ Passkey は M1（AASA/assetlinks・8/8 登記後）。それまでアプリ初回ログインは OTP ブートストラップで先行し PIN を前倒し撤廃できる。

### 2-2. アイデンティティ作成 → 会社参加フロー

> **注**: 下記6ステップは初期の概念整理。具体の順序・手段（web一本化・PIN撤廃・電話OTP初回ログイン・Passkey・KYC範囲）は **§2-1a（2026-07-24 確定）が正本**。identity×org の PII 開示同意まわり（下記の表・`pii_disclosures`）は引き続き有効。

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

### 2-5a. プラットフォームコンソール（/platform）★Phase 1 実装済み 2026-08-01・拡大方針

**根本方針: プラットフォーム運営者にも「デフォルトで見えない・見る時は記録が残る」**。
DB オーナーの技術的全能は消せないため、①構造（PII を返すエンドポイントを作らない）②記録（監査ログ）③契約（§2-5 ⑥）の三層で統制する。

**Phase 1（実装済み・migration 120）**
- `platform_admins`（identity 基準・org membership と独立）＋ `requirePlatformAdmin`
- `/platform` ダッシュボード: org 別の**集計のみ**（active/KYC済ドライバー数・当月の日報/稼働/通知/LINE通数・最終日報・参加コード）
- `/apply`（公開申請フォーム）→ `org_applications` 台帳 → `/platform/applications` で審査 → 承認で org ブートストラップ（organizations＋system ロール4種＝`DEFAULT_ROLE_CAPABILITIES` 正本＋初代 ADMIN 招待14日）
- `platform_audit_logs`: プラットフォーム操作を全記録（Phase 1 は記録のみ・閲覧 UI なし）

**Phase 2 以降の拡大方針（優先順は実需で入れ替え）**
1. **監査ログ閲覧 UI**（自分の操作履歴を自分で監査できる状態に）
2. **Break-glass サポートアクセス**: 個社データを見る必要がある時だけ org 単位・期限付きで明示的に有効化 → 期間中の閲覧を全件監査記録。将来は org 管理者への通知/同意とセット（Stripe/Shopify のサポートアクセスモデル）
3. **API 利用状況の実測**: 現状は業務活動量（日報・稼働等）を代理指標にしている。HTTP レベルの呼出回数は計装（軽量カウンタ or Vercel Observability 連携）が必要
4. **DB 層の構造的 PII 遮断**: コンソール API を service_role でなく専用 postgres ロール＋集計ビュー経由に（「構造的に読めない」を DB で担保。own化/RLS トラックと同じ流れ）
5. **org ライフサイクル管理**: suspend/resume、解約時のデータ削除ポリシー実行（§2-5 ⑤）
6. **LINE 通数の org 別上限管理**: `org_notification_settings.line_monthly_limit` の設定をコンソールへ集約（migration 111 の土台を UI 化）
7. **課金・プラン管理**: エンタープライズ価格の契約・請求管理
8. **KYB 実務支援**: 法人番号の国税庁 API 照合・登記資料アップロード・申請着信のメール通知
9. **org 発行時の運営者認証方式の選択**（SSO/Passkey/メールOTP、§2-5 の表）
10. **メトリクスの時系列化**（月次推移・成長の可視化）

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
| `can_dispatch` | 配車（シフトへの車両割当・貸出管理）。migration 105 で追加（A1） | ✕ | ✕ | ✕ | ○ |
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

#### 2-6a. スコープ付き権限（own / any）と works_as_driver ★実装済み（migration 104）

RBAC（ロール＝capability の束）では「シフト希望は更新できるが**他人のものは不可**」を表現できない。
ハコ虎AI（エージェントがドライバーの代行で `updateShift` 等を呼ぶ構想）の土台として、判定を
**「権限 × 対象リソースの所有者」の2軸**に拡張した。

- **any スコープ** = 既存の `can_*`。org 全体のリソースに対して行える（意味・データとも従来どおり）。
- **own スコープ** = `own_*`（`own_submit_reports` / `own_manage_shift_requests` / `own_view_shifts` /
  `own_view_rewards` / `own_manage_profile`）。対象の所有者が本人のときだけ許可。
- 判定の正本は純関数 `checkPermission(grants, actorDriverId, {any?, own?, ownerDriverId?})`
  （`server/auth/policy.ts`。DB・リクエスト非依存）。HTTP ルートは `requireScopedPermission`
  （`server/auth/authorize.ts`）を使い、`scope === "own"` のときクエリを本人に絞る。
  ハコ虎AI は「委任トークンの権限 ∩ 本人の解決済み権限」を同じ関数に通す（権限の減衰）。
- **works_as_driver（ドライバーとして扱う）**: 役割（ロール）と稼働可否を直交化するフラグ。
  **正本はドライバー個人（`drivers.works_as_driver`）**で、ロール画面のメンバーチップ
  （トラックアイコン）から個別にトグルする。`roles.works_as_driver` は**ロール割当時の
  既定値**に格下げ（ON のロールを割り当てたときだけ個人フラグを引き上げる。OFF への
  上書きはしない＝管理者へ昇格してもドライバー稼働は失われない）。DRIVER ロールの
  メンバーは常に ON（サーバー側で固定）。
  シフト・勤怠・名簿等のドライバー抽出は `role='DRIVER'` ハードコードからこのフラグに置換済み。
  own 権限は現状このフラグ保持者に一括付与（ロール別細分化・パスキー紐づけの個人グラントへ
  正本を移す場合も `resolveGrants` の返す形は変えない）。
- **注意（クライアント互換）**: own 権限は `StoredDriver.capabilities` に**入れない**。
  モバイルの運営モード判定（`capabilities.length > 0`）と管理ログインの
  「capability 0個なら403」が「運営権限の有無」を capabilities で判定しているため。
- 旧 `requireAuth(req, "DRIVER")`（約41ファイル）は own スコープへの段階置換対象。
  参照実装: `/api/shifts/requests`（GET=own_manage_shift_requests/any=can_view_shifts、
  POST=own_manage_shift_requests/any=can_manage_shifts）と `/api/me/shifts`。
- **設定 UI**: capability を直接チップで並べるのをやめ、Discord の権限上書き画面風の
  「1機能=1行 × 許可なし/閲覧のみ/編集可能」に統一（`PERMISSION_ROWS`、編集可能=view+manage）。
  view 権限が無いドメインは AdminLayout のメニューをロック表示（グレー＋鍵）し、
  「そもそもアクセスできない」ことを明示する（正本はサーバーの requirePermission 403）。

**AI 駆動化に耐えるための階層分離（合意事項）**

1. **権限層（誰が・何を・誰のものに）** = checkPermission。own/any とリソース所有者で判定。
2. **業務ルール層（いつ・どんな状態で）** = 各ルートのドメインロジック。希望休の締切
   （monthPeriods → closed 期間の保護）、承認フロー、不正入力の破棄など。
   **権限があっても業務ルールは緩まない**。ハコ虎AI は必ず本人委任のトークンで
   同じ API ／同じドメインロジックを通す（AI 専用のバイパス経路・直接 DB 書込を作らない）。
   → 「締切済みの希望休提出が AI 経由だとできてしまう」は構造的に起きない。
3. **委任層（AI に何を許すか）** = 委任トークンの scopes。実効権限 =
   本人の Grants ∩ トークン scopes（減衰のみ・昇格なし）。実装時は
   `resolveGrants` の結果に交差を掛けて checkPermission へ渡すだけ。

**リソース条件への拡張パス（例:「Amazon は見せるがヤマトは不可」）**

将来、権限付与を無条件から条件付き（carrier / course 等のリソース属性で絞る）にする場合:
- `role_capabilities`（または個人グラント表）に `conditions jsonb`（例 `{"carrier_id": [..]}`）を追加
- `Grants` の Set を「権限 → 条件リスト」の Map に拡張し、`PermissionSpec` に
  `resource?: { carrierId?, courseId?, ... }` を追加して checkPermission 内で条件評価
- 判定が checkPermission 1点に集約されているため、**全ルートと AI ツールに一括で効く**。
  ルート側の変更は「対象リソースの属性を spec に渡す」だけ。
  それまでは条件なし＝org 全体（現状の挙動）を既定とする（昇格制: 必要になるまで実装しない）。
- **`features` と別レイヤ**: `organizations.features`（機能ON/OFF）は「その機能が有効か」、capability は「有効な機能を誰が使えるか」。混同しない。
- ⚠️ **`ACCOUNTING`（migration 091 で DB CHECK に追加済）は JWT verify ホワイトリスト・型に未反映**＝現状ログイン不可。本フェーズの role 化で同時に解消する。

---

## 3. テナント分離の実装（API層・default-deny、RLSなし）

- `src/server/db/tenant.ts`（新規）に **org_id スコープを必ず付与する薄いラッパ**を用意。各ルートの手書き `.eq` は廃止していく。
- 既存の一元化済みローダ（`src/server/aggregation/legacyShape.ts` の `loadLegacyDailyRows()`、`loadAggregationData()` 等）に **orgId 引数を必須化**して差し込む（集計の単一通り道）。
- 「会社スコープ未適用のクエリを書けない/検出できる」状態を目標に、レビュー観点 or 簡易 lint（`from("drivers")` 直書き検出）で担保。
  → **✅ 2026-07-22 実装**: `apps/web/src/scripts/check-tenant-scope.ts`（`npm run check:tenant`）。
  migration から「org_id / owner_org_id を持つテーブル」を自動抽出し、それらへのクエリに
  org 絞りがあるかを静的検査する。違反があれば exit 1（CI 用）。
  意図的に全件を引く場合は行末に `// tenant-scope-ok: 理由` を書く。
  ※これを入れた経緯: RLS 不使用の構成では**アプリ層の書き忘れが即・他社データ露出**になる。
    実際に vehicles-unlinked / admin/shifts / oil-alert-count / 日報系の drivers 参照などで
    org 絞り漏れが見つかった（2026-07-22 に修正）。RLS の代わりの二重防御として常設する。

### 3-0. 2026-07-22 テナント分離の総点検（実施記録）

**きっかけ**: 車両画面の不具合調査中に `reports/vehicles-unlinked` の org 絞り漏れを発見。
横断検査を作って全 API を洗ったところ、**読み取りだけでなく書き込みの越境**が複数見つかった。

**特に重かったもの（すべて修正済み）**
| 箇所 | 内容 |
|---|---|
| `admin/daily/approve` | 他社ドライバーの日報を承認でき、**その車両の走行距離まで書き換えられた** |
| `admin/daily/reject` | 他社の日報を却下できた |
| `admin/daily/reports/proxy` | 他社ドライバーの日報を代理作成・上書きできた |
| `admin/daily/report-form` | 他社ドライバーの日報内容・コース構成が閲覧できた |
| `reports/meter-baseline` | vehicleId 差し替えで他社車両の走行距離が取れた |
| `admin/courses` PATCH / `admin/submit-screen` PUT | `update().eq("id")` のみで他社行を書き換え可能だった |
| `admin/carriers/[id]` DELETE | 他社の有効化行（company_carriers）まで消しうる |

いずれも「リクエスト由来の driverId / vehicleId をそのまま使い org を見ていない」型。
**共通ローダーは引数で org を必須化した**（`loadLegacyDailyRows(supabase, orgId, …)` /
`loadCourseDailyLease(supabase, orgId)` / `loadDailyLeaseByVehicleMonth(supabase, orgId, ids?)`）。
署名で強制する形にしたので、新しい呼び出しで org を忘れると型エラーになる。

**検査スクリプト自体の穴**: 当初テーブル名の正規表現に数字が無く、`daily_reports_v2`（日報本体）を
丸ごと見逃していた。修正後に上記の重大漏れが検出された。**「検査が通った＝安全」ではなく、
検査の対象範囲そのものを疑うこと。**

**未対応（設計判断が必要）**
- `orgCarriers.ts` の `orgOwnsCarrier` は `company_carriers` に行が無い org を「全許可」でフォールバックする
  （087 未適用対策）。未設定の org が共有マスタ `carriers` を編集できる。共有マスタの認可設計の問題。
- `reports/meter-baseline` の fallback（`vehicles.current_mileage` を id 直指定）は貸与車対応のため
  org を絞れない。UUID 直打ちで他社車両の走行距離が読める余地が残る。

**越境の統合テストは未整備（2026-07-22 時点）**
`vitest.itest.config.mts` と `src/test/itest/tenantIsolation.itest.ts` は存在するが、
**テスト用 Supabase が消えており（DNS 解決不可）実行できない状態**。既存テストも集計3件のみで、
今回見つかった書き込み越境をカバーしていなかった＝「テストはあるが動かず、実際の越境を防げなかった」。
**別 org の追加が現実味を帯びた時点で、テスト環境の再作成とセットで整備する**（ユーザー判断 2026-07-22）。
それまでは静的検査（`npm run check:tenant`）が唯一の防壁。

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
- **2段階承認（本人確認）✅完了**（migration 090=`drivers.kyc_verified_at`/`kyc_verified_by`）: プライバシーで仮登録を最小化した副作用＝「承認=顔/免許の目視確認」（§2-2）を是正。**仮承認(pending→active)→本登録→本承認(運営が顔/免許を目視)→アプリ解放**。`GET /api/admin/users?stage=kyc`（本人確認待ち）／`GET /[id]/kyc`（免許/顔の署名URL・ADMIN/VIEWERのみ）／`POST /[id]/verify-kyc`（approve→kyc_verified_at / reject）。admin `/admin/users/pending` に本人確認待ちセクション＋KYCレビューモーダル。mobile ハードゲート3状態（本登録未完→ウィザード／本承認前→KycPending待機／本承認済→タブ）。※2026-07-25 §2-1a で**承認1回に統合**（pending 承認モーダルで KYC 目視→active＋kyc_verified_at を同時完了）。verify-kyc と本人確認待ちリストは KYC 後出し・既存ドライバー移行用に存続。
- **免許期限 OCR ✅完了**（コードのみ）: `core/logic/license.ts` `parseLicenseExpiryFromOcr`（純粋・和暦/西暦・括弧併記対応・「まで有効」優先）＋テスト。mobile は端末側 ML Kit（`@react-native-ml-kit/text-recognition`・和文・画像は端末から出ない）で免許写真→期限プリフィル→**ユーザー確認**。読めなければ手入力。
- **dev 環境＋mobile アプリ ✅基盤**: 独立 dev Supabase＋`npm run db:migrate`（台帳方式 `_migrations`）。`apps/mobile`（Expo SDK52・React18.3・`@repo/core` 再利用）＝ログイン/仮登録/本登録/日報/希望休/報酬/マイページの全画面を実装し **NativeWind** に統一。実機ビルド・SMS・OCR は実機で確認。詳細は memory `tenant-migration`/`rn-migration-core-layer`。
- **Phase 8 — 隔離テスト ✅基盤完了**: 実DB(Supabase ブランチ)に supabase-js で接続する env-gated 統合テスト（`npm run test:itest`、`*.itest.ts`）。使い捨て2 org を seed し集計/ledger/mutation の隔離を assert。ルートレベル(JWT+NextRequest)テストは follow-up。

- **Phase 5b — 整合性制約 ✅完了**（migration 091）: identity/membership の不変条件をDB化。`identities(phone)` 検証済み部分ユニーク（1人=1 identity）／`drivers(identity_id, org_id)` 却下以外で部分ユニーク（1人×1社=1所属）／`drivers.role` に `ACCOUNTING` 追加。対の `api/join/route.ts` を find-or-create 冪等化（複数行で壊れない・並行/再送の 23505 を「申請済み」に吸収）。検証=tsc clean・258緑。

- **Phase 9 — 基盤の作り込み（一部完了）**: 以下は複数所属の本番運用に必要で、相互に絡む。
  - **認可モデル（§2-6）✅完了**（2026-07-20、migration 092-094・104）: `roles`/`role_capabilities`＋`drivers.role_id` 移行、`requirePermission(cap)` 置換、ロール管理UI（Discord 風の許可なし/閲覧のみ/編集可能）、`works_as_driver`（個人単位・§2-6a）、own/any スコープ権限の土台（`checkPermission`/`requireScopedPermission`）、旧 `requireAuth` のロール階層ゲート**全撤廃**（ADMIN/ADMIN_OR_VIEWER 分岐削除・DRIVER=セルフスコープの目印のみ。091 の置き土産＝ACCOUNTING/カスタムロール 403 を解消）。メニューは view 権限が無いドメインをロック表示。残: 本人系ルートの own スコープ細粒度化（シフト系は移行済・他は「認証のみ」で通る過渡状態）。
  - **PII 開示同意（§2-2）**: `pii_disclosures` 追加。`kyc/route.ts` を `can_view_pii`＋開示同意の二重ゲート＋監査ログに。2社目参加ウィザードの開示同意・免許更新時の `kyc_verified_at` クリア。
  - **承認ステートマシン**: membership の状態（`status` + `kyc_verified_at` + 導出 `complete`）を1列の明示遷移（pending→approved→kyc_submitted→verified→suspended 等）に集約。
  - **invites（招待エンティティ）**: `organizations.join_code` 1個に潰れている招待を独立化（token/kind=url|qr|code・role・expires_at・max_uses・revoked_at）。join_code は「無期限 open invite」の1特殊行として内包。

各 Phase は独立リリース可。**Phase 2 完了まで2社目を本番投入しない**条件はクリア済（org_id 基盤・スコープ・制約・キャリア別化・隔離テストまで完了＝技術的に2社目を載せられる土台）。認証（Phase 6b）もPasskey/SMS OTPまで完了。残りは会社切替UI（複数org選択）・LINE連携・Phase 9 の残り。**未完項目の統合管理は docs/roadmap-2026-07.md**（2026-07-20 に新規5テーマと合流）。

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
