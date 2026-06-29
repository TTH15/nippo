# ハコ虎 モバイル完全移行ロードマップ（2026 H2）

> 作成: 2026-06-29 / 目標: **2026-09-01 までにドライバーを Web PWA → ネイティブアプリへ完全移行**
> 本書は計画。実装は別途着手。詳細メモは memory `mobile-app-roadmap` / `vehicle-qr-workflow` / `branding-hakotora` / `tenant-migration` 参照。

---

## 0. 現状サマリ（2026-06-29 時点・コード監査済）

- `apps/mobile`（Expo + EAS, iOSネイティブ生成済, `@repo/core` 共有）。**ドライバー主要フローは実装済み・呼ぶAPIは全て存在**。
- タブ: 業務 / 日報 / 希望休 / 報酬 / マイページ ＋ Login / Register(参加コード+SMS OTP) / KYCウィザード(端末内ML Kit OCR)。
- 認証: driverCode + 6桁PIN → 30日JWT(SecureStore)。
- **車両QR業務フロー（出退勤打刻＋車両紐付け）はサーバ／モバイル／運営UIとも実装済・実機e2e検証OK**。
- migration 088–098（identity / passkey_credentials[空] / KYC / vehicle_sessions / QR / meter-photos）は **main済**。
- **未着手の本丸 = デザイン**（「動くが見た目はほぼ素」）と **リリース足回り**・**通知(LINE)**・**機能パリティの穴**。

## 1. スコープ確定事項（2026-06-29 合意）

- **LINE連携**: 友だち追加 → 公式LINE(Messaging API)から **個別通知** ＋ ハコ虎からの **一斉配信(broadcast)**。LINEログインは不要。
- **請求書承認**: **ドライバーがモバイルで行う** → 請求書 表示・承認画面が必須。
- **初回ゴール**: **内部配布**（iOS TestFlight / EAS internal、Android 内部テスト）。一般公開（ストア掲載素材・審査）は後回し可。ただし内部配布でも **アイコン・実bundleId・ATS除去** は必要。
- **デザイン(M-D)** はユーザー強く希望の優先トラック。業務開始/終了フローは **`docs/qr_flow.md` v2.0** を正本に再設計。
- **OTA(expo-updates)**: 採用推奨（内部配布期に軽微修正を即配信）。
- **Passkey**: ドメイン確定(hakotora.jp)で着手可。**PINと併存（フォールバック）**で段階移行。v1移行の必須ではない。
- **認証/参加フロー(identity/join)** は実装済み。残る認証強化は Passkey のみ。

---

## 2. マイルストーン（残タスク全体）

### M-D モバイルUIデザイン（最優先トラック）
- ハコ虎 デザインシステム（配色 / タイポ / 余白 / 共通コンポーネント）。`branding-hakotora` と連動。
- **業務開始/終了フロー再設計（qr_flow v2.0）**＝「打刻アプリではなく業務開始プロトコル」:
  - 1つの円形ボタンが状態変化（稼働開始→長押し充填+Haptic→**その場で円形カメラ**→✓、**画面遷移なし**）。
  - **Bottom Sheet中心**（Bottom Nav非表示）: 安全確認(免許携帯チェック＋一定確率で免許OCR抜き打ち) → 車両記録(オドメーターOCRガイド＋**4方向点検 前→右→後→左** 半透明ガイド) → 業務開始ホーム(稼働開始時刻/使用車両/今日の実績/給油/記録) → 終了(同演出＋Bottom Sheetでオドメーター/給油/返却/忘れ物 → サマリー 稼働時間/件数/距離)。
  - カメラ画面は必ずガイドライン表示（QR/オドメーター/車両/免許）。
- 他画面の視覚デザイン: Login / KYC / 日報 / 希望休 / 報酬 / マイページ。
- ※この再設計が現 `WorkScreen` を置換し、**M5（点検写真UI・QRフォールバック）を内包**。

### M1 リリース足回り（内部配布の前提・blocker）
- アプリアイコン / スプラッシュ作成 → `app.json` 設定（現状 assets 無し）。
- name / slug / **bundleId（`com.example.nippomobile` は審査NG → `jp.hakotora.*`）** / scheme の本番化（ネイティブ再生成要）。
- **ATS `NSAllowsArbitraryLoads` 除去**（`app.json` ＋ `ios/.../Info.plist`）→ 本番HTTPS API。
- EAS: `submit.production` 資格情報（後段）／**プロファイル別 `env`** で本番API URL・COMPANY_CODE（現 `.env` は dev LAN IP）。
- version / buildNumber 戦略。

### M2 本番データ / インフラ（ops・早めに）
- 本番DBへ migration 089→098 適用（順序厳守）。
- 本番Supabaseに `kyc-documents`(089) ・ `meter-photos`(098) バケット存在確認（無ければ手動作成）。
- ADMIN_VIEWER アカウント発行（`create-admin.ts --readonly`）。

### M3 通知（LINE主軸 ＋ アプリ内プッシュは任意）
- **LINE公式アカウント + Messaging API チャネル開設**。
- **友だち追加導線**（登録完了時に QR / URL）。
- **LINE userId ↔ driver/identity 紐付け**（webhook follow → ワンタイム紐付けコード等。設計が肝）。
- サーバ: **webhook受信＋署名検証＋channel secret/access token管理**、個別 push、**一斉配信の運営(web)UI**（全員/絞り込み）。
- 用途: KYC承認 / 希望休締切 / 支払い準備 / 運営連絡。
- アプリ内 `expo-notifications` は LINE で足りれば v1 省略可（必要なら APNs/FCM ＋トークン保存）。

### M4 機能パリティ（モバイルに不足）
- **PIN変更**（web: PATCH `/api/reports/profile`）。
- **諸報告**（oil-change 動的フォーム＋ファイル添付）。
- **請求書 表示・承認**（`/api/me/invoices` ＋ approve。**確定: ドライバー承認**）。
- nice: チーム戦 / 任意経費 / 車両preference / 各種既読系（backend有・UI無）。

### M5 車両QRの穴（M-Dの業務フロー再設計に内包）
- QR読めない時の **plate-OCR / 手動フォールバック導線**（API/型は対応済・UI無＝今は詰む）。
- **点検写真**（pre/post 4方向, `vehicle_inspection_photos`）UI。
- nice: メーター写真の保持・クリーンアップjob、当日履歴表示。

### M6 堅牢性 / UX
- エラー監視（Sentry等）。
- オフライン書き込みのキュー・リトライ。
- トークン失効UX（現状 401 で無言ログアウト → 明示メッセージ / 生体再認証）。

### M7 仕上げ（nice-to-have）
- タブアイコン・絵文字置換（🔒 等 → Font Awesome系）。
- Pull-to-refresh / DatePicker化 / OTP resend cooldown / 住所〒補完。
- **OTA(expo-updates)** 導入＋ `runtimeVersion`。

### M8 Passkey（ドメイン確定で着手可・PIN併存）
- サーバ RP（`@simplewebauthn/server`）＋ **Web版Passkeyを先行**（ネイティブ前提不要・`passkey_credentials` 結線・flow検証）。
- ネイティブPasskey（後段・M1依存）: hakotora.jp が **AASA / assetlinks.json 配信**、`app.json` `associatedDomains`＋scheme、`react-native-passkey` 等 → **新dev build**。

---

## 3. タイムライン（6/29 → 8/31、約9週）

| 週 | 期間 | 重点 | 目標(Done) |
|----|------|------|-----------|
| — | 〜6/29 | 計画・コード監査 | ✅ 本書・スコープ確定 |
| W1 | 6/30–7/6 | M1 足回り＋M2 ops＋M-D 基盤 | 内部配布ビルドが本番HTTPSを指す（仮アイコン可）／本番migration適用・バケット確認／デザインシステム雛形 |
| W2 | 7/7–7/13 | M-D 業務フロー設計確定＋実装着手 | qr_flow v2.0 のUI設計確定（円形状態機械・Bottom Sheet）／ホーム＋認証フェーズ実装 |
| W3 | 7/14–7/20 | M-D＋M5 業務フロー実装 | 安全確認→車両記録(オドOCR＋4方向点検)→業務開始/終了＋サマリー が実機で通る／plate-OCR・手動フォールバック |
| W4 | 7/21–7/27 | M4 パリティ① | PIN変更／諸報告（動的フォーム＋添付）実装 |
| W5 | 7/28–8/3 | M4 請求書 ＋ M3 LINE① | 請求書 表示・承認画面／LINE公式アカ・友だち追加・webhook・userId紐付け |
| W6 | 8/4–8/10 | M3 LINE② ＋ M6 | 個別push＋運営一斉配信UID／Sentry・トークン失効UX |
| W7 | 8/11–8/17 | M-D 他画面デザイン ＋ M7 | Login/KYC/日報/希望休/報酬/マイページの視覚デザイン／OTA・アイコン確定・絵文字置換 |
| W8 | 8/18–8/24 | 仕上げ ＋ Passkey(任意) | オフライン対応・Pull-to-refresh・DatePicker／(余力)Passkey サーバ＋Web先行 |
| W9 | 8/25–8/31 | 実機QA・内部配布・移行 | 全ドライバーへ内部配布、PWA併走で**段階移行→完全移行**、バッファ |

> Passkey ネイティブ・一般公開（ストア掲載/審査）・請求書自動補完などは **9月以降**（移行後）に回す。

## 4. クリティカルパス & 依存

- **移行の必須(critical)**: M1（配布できる）→ M2（本番データ）→ M-D/M5（業務フロー＝毎日使う核）→ M4（請求書・PIN・諸報告＝web代替に必要）→ M3（LINE通知＝連絡手段）→ M6（落ちない）。
- **並行可**: M7 仕上げ、M8 Passkey（サーバ/Web先行）。
- **依存**: ネイティブPasskey は M1(bundleId) ＋ hakotora.jp の AASA/assetlinks 配信に依存。LINE個別pushは userId↔driver 紐付け設計に依存。

## 5. リスク / 前提

- **Apple Developer / Google Play アカウント** と Team ID 確定（bundleId・TestFlight・将来公開に必須）。
- **LINE Messaging API** チャネル開設・公式アカウント審査の所要時間。
- **hakotora.jp** が AASA/assetlinks を配信できる状態（Passky・ディープリンク用）。
- 端末でのOCR精度（オドメーター7セグは「写真が真実＋手入力補助」方針）。
- デザイン（qr_flow v2.0）は体験の核＝**反復が必要**。W2–3 にバッファ込みで確保。
- 移行は **PWA併走→段階移行**で安全に（いきなり全停止しない）。

## 6. 完成（モバイル完全移行）の定義（DoD）

1. ドライバーが**ネイティブアプリだけ**で日次業務を完結: ログイン→KYC→業務開始(QR/点検/メーター)→日報→希望休→報酬→請求書承認→諸報告。
2. 本番HTTPS APIに接続・ATS適正・実ブランド（ハコ虎）アイコン/識別子。
3. **LINE通知**で運営からの連絡（個別＋一斉）が届く。
4. 主要操作がデザイン済み（qr_flow v2.0 の業務フロー含む）。
5. エラー監視・基本的な失効/オフライン挙動が整備。
6. 全ドライバーに内部配布され、PWA無しで運用できる。

---

## 7. 将来構想（移行後の次フェーズ・2026-06-29 追加）

移行(9/1)優先のため着手は後段だが、計画として確保。

### 7-1. ハコ虎AI（チャット形式の業務アシスタント）
- ドライバーが**自然言語で**(a) 業務に関する質問(ルール/報酬/手順/車両/FAQ)、(b) **希望休(シフト)の入力**ができるチャット。
- チャネル候補: **LINE公式アカウント上のボット**（M3のLINE基盤に相乗り＝友だち追加済み・userId紐付け済みを活用）／アプリ内チャット。LINE先行が低コストで到達率高。
- 技術: LLM(Claude API) ＋ **tool-calling**で既存APIへ接続（希望休登録 `/api/shifts/requests`、締切 `/api/shifts/deadlines`、報酬 `/api/me/rewards` 照会等）＋ 業務ドキュメント/FAQの **RAG**。
- 要件: LINE userId↔driver の本人特定（M3で実装）、操作の確認ステップ（誤登録防止）、ガードレール、監査ログ。
- 依存: **M3(LINE連携)が前提**。移行後に PoC → 段階導入。

### 7-2. 過去データの請求書取り込み
- 既存の**過去の請求書/billingデータをシステムへ取り込む**（履歴の電子化・集計連携）。
- 想定: 過去PDF/紙の請求書を OCR/パース → `invoice_documents`(＋明細) へ取り込み、または過去の売上/支払い記録のバックフィル。
- 要確認(次回): 取り込み元(PDF/紙/CSV/別システム)・対象期間・突合キー(取引先/月/コース)・自動化 vs 手動補正の比率。
- 依存: 請求書システム（[[memory: invoice-creation-system]]）。集計監査(H2/H3/H4)とも整合を取る。

---

## 付録: 非モバイルの並行・保留項目（移行優先で当面ペース調整）

- **請求書 集計監査**（H2/H3/H4: セクション経路の帰属、`shifts`/`courses`/`sales_log_entries` の org_id スコープ）＝本番金額直結・要判断。memory `invoice-creation-system`。
- **請求書 Canva化**（列幅/書式/罫線色・点線/セル結合/簡易計算）＝運用しながら漸進。memory `invoice-canva-table-plan`。
- 旧移行期の **日報 真の重複**（5/16・5/25・6/12・6/07 等）の整理。memory `admin-daily-legacy-display`。
- 消費税有無・文言・サマリー構成の **org設定化**。memory `org-feature-flags`。
