# ハコ虎 Base（現場運営アプリ）の業務範囲と構成

2026/09/17 起草。[ロードマップ](../roadmap-2026-09.md) の BASE-1・BASE-2 に対応する設計。既存コードの調査に基づく提案であり、**アプリの実装・プレビュー・配布はまだ行っていない**。初回範囲と識別子は着手前にユーザーの確定が要る（末尾の「決めてほしいこと」）。

## 1. 3つのアプリの分担（BASE-1）

境界を1つの原則で決める。

> **その場で起きた事実を記録・確認するのが Base、事実から金額や条件を決めるのが Web。自分の業務を進めるのがハコ虎。**

| | ハコ虎（ドライバー） | ハコ虎 Base（現場運営） | Web（管理） |
|---|---|---|---|
| 誰が使う | 本人 | 現場の担当者（会社の端末） | 運営・経理 |
| 対象 | 自分の業務 | 他の人・車両・鍵 | 会社全体 |
| 端末 | iPhone | iPad 推奨・iPhone 可 | PC |
| 例 | 稼働開始、メーター、点検、日報、駐車、自分のシフト・希望休 | 受付と本人確認、確定済み契約の提示と署名、車両・鍵の受渡し、傷の撮影、車両移動、事故・故障の受付、研修、未出勤・未返却の確認 | 請求、報酬確定、控除、振込、単価・契約条件の変更、会社設定、権限管理、シフト作成、分析 |

境界で迷ったときの判定:

- **金額が動く・条件が変わるなら Web**。Base に持たせない。
- **相手がその場にいるなら Base**。対面で確認して署名・撮影・受渡しをするものは iPad の役割。
- **自分ひとりで完結するなら ハコ虎**。Base に同じ操作を二重に作らない。

金銭処理を持たせなくても、会社・担当者・操作ごとの**認可と記録は必要**。Base から金銭・条件変更のAPIへ到達できないことは、アプリの画面を出さないことではなく**サーバー側の capability** で保証する（現在のモバイルは `driver.capabilities?.length > 0` で運営モードを出すだけの粗い判定なので、Base ではこれを流用しない）。

## 2. 初回にやること（提案）

**初回は「車両と鍵の受渡し」1本に絞る。**

理由:

- 既に業務リスクとして特定済み。[業務事故の事前検知](operational-risk-detection-2026-09.md) O-4 の「配車があるだけで準備完了にしない」「引渡し未完了・実際の所在が分からない」に直接効く。
- 既存設計 [受け渡しと通知](vehicle-handoffs-and-notifications.md) があり、ゼロから業務を決めなくてよい。
- 金銭に触れない。認可の境界を作る最初の題材として安全。
- 「相手を確認する → 写真を撮る → 時刻と担当者を残す」という Base らしい操作の型を最初に作れ、後の受付・点検・事故受付がその型に乗る。

初回に**入れない**もの（理由つき）:

- **契約の提示と署名** — 電子契約は [文書基盤](document-platform.md) の実装待ち。署名ライブラリも未導入で、iPad 実機検証（BASE-5）が先。
- **受付・本人確認** — 免許 OCR（`apps/mobile/src/ocr/recognizeLicense.ts`）は転用できるが、`/join` の初期登録web一本化と役割が重なる。重複を確認してから決める。
- **研修** — 業務内容そのものが未定義。
- **駐車位置・車両移動** — ドライバー側（ハコ虎）で進行中。Base 側は運営が代理で直す用途に限るので、まずドライバー側の完成を待つ。

## 3. 共有端末の扱い

Base は**会社の iPad を複数の担当者が使う**前提。現行モバイルの作りは1端末1人なので、そのままでは成立しない。

- 現行の生体ロック（`apps/mobile/src/components/BiometricLock.tsx`）は共有端末では機能しない。Base では端末ロックか、担当者ごとの短い再認証に置き換える。
- 認証ストアは `packages/core/src/auth/store.ts` の単一セッション（`nippo_token` / `nippo_driver`）。**複数セッションの保持**か、**明示ログアウトによる切替**のどちらかを決める必要がある。
- どちらにしても、**操作の記録は担当者単位**で残す。端末単位にしない。
- 相手（ドライバー）の本人確認は、担当者のログインとは別の事実として扱う。

## 4. 別アプリの構成（BASE-2・調査結果）

`apps/base` を workspaces に置けば取り込まれる（root `package.json` の `apps/*`）。既存 `apps/mobile` から**複製が要るもの**と**そのまま共有できるもの**は次のとおり。

### そのまま共有できる

- `@repo/core`（`packages/core`）— 認証ストア、fetch ラッパ、`logic/*` の計算、`types/*`。React Native への依存がないので Base からもそのまま使える。`~/Developer/packages/` からの vendor コピー（`@platform/*`）も core 経由で届くため、`sync-packages.sh` の対象は変わらない。

### 複製・追記が要る（漏れると動かない）

| 対象 | 元 | 備考 |
|---|---|---|
| metro 設定 | `apps/mobile/metro.config.js` | `watchFolders` にworkspace root、`nodeModulesPaths` 2段、`unstable_enablePackageExports`（`@repo/core` の subpath 解決に必須）、`withNativeWind` |
| babel 設定 | `apps/mobile/babel.config.js` | `jsxImportSource: "nativewind"` + `nativewind/babel` |
| tsconfig の paths | `apps/mobile/tsconfig.json` | `@repo/core/*` → `packages/core/src/**` |
| NativeWind の型 | `apps/mobile/types/safe-area-classname.d.ts` | safe-area-context 5.x の className 拡張 |
| root の typecheck | root `package.json` の `typecheck` | `-w @repo/web` `-w @repo/mobile` がハードコード。**追記しないと CI に載らない** |
| Vercel 除外 | `.vercelignore` | `apps/mobile` と同じく `apps/base` を除外する |

root の `overrides`（react 19.2.3 / metro 0.84.5）は Base にもかかるので、**Base も Expo SDK 57 に揃える**。root に react / react-native / expo を直接依存で足さないルールは維持する。

### 識別子・配布

- `bundleIdentifier` / Android `package` は**別 ID が必須**（`jp.hakotora.app` は既存）。SecureStore は iOS Keychain のアプリ単位なので、ID を分ければ `nippo_token` が同名でも衝突せず、同じ端末で両アプリに別々にログインできる。
- 既存 `apps/mobile/app.json` は `name: "Nippo Mobile (dev)"` / `slug: "nippo-mobile"` の仮名のままで、`scheme` も未設定。Base を作るなら**この機に両方の名前を確定させる**のが自然。
- **`eas init` は未実施**（`extra.eas.projectId` が無い）。EAS プロジェクトを2つに分けるか1つでプロファイルを分けるかは未決定。内部配布の経路も Base 用に決める。
- ネイティブプロジェクト（`ios/` `android/`）は `.gitignore` 済みの CNG 運用。Base も同じにする。

### iPad 対応の現状

- `supportsTablet: true` だが `orientation: "portrait"` 固定。**Base は横向きを許可しないと分割表示が成立しない**。ハコ虎側は portrait のままでよい。
- 画面幅への応答はほぼ無い（`useWindowDimensions` は2箇所、NativeWind の `md:`/`lg:` は0件）。**一覧＋詳細の2ペインは新規設計**になる。
- QR は導入済み（`expo-camera` の `CameraView`）。OCR は ML Kit オンデバイス。**手書き署名・PDF 表示・NFC は未導入**で、採否は iPad 実機検証（BASE-5）の後。

### 転用したい部品

`CaptureFlow.tsx` / `QrFallback.tsx` / `ocr/*` / `BottomSheet` / `Skeleton` / `VehiclePlateMini` は Base でも効く。ただし共通化の形は未決定で、**先回りの共通化はしない**（昇格制）。最初はコピーで始め、2つ目のアプリで同じ変更が2回必要になってから共通化を検討する。業務名詞を含むコードを `packages/` へ置かないルールは維持する。

## 5. プレビューの課題

AGENTS.md の標準手順（`scripts/previews/fixtures/` と `/preview/admin/<slug>`）は **web 前提**で、React Native アプリには使えない。BASE-3（iPad・スマホの操作プレビュー）を回すには、モック API の baseUrl を差す方式か fixture 注入方式かを先に決める必要がある。ここが決まらないと BASE-3 は着手できない。

## 6. 決めてほしいこと

1. **初回範囲**: 「車両と鍵の受渡し」1本でよいか。別の業務を先にしたい場合はどれか。
2. **アプリ名と識別子**: Base の bundleId（例 `jp.hakotora.base`）、表示名、scheme。既存モバイルの仮名（`Nippo Mobile (dev)` / `nippo-mobile`）も同時に確定するか。
3. **共有端末の利用者切替**: 複数セッションを持つか、明示ログアウトで切り替えるか。
4. **EAS**: プロジェクトを分けるか1つにまとめるか。内部配布の経路。
5. **RN のプレビュー方式**: BASE-3 の前提（§5）。

## 7. 残タスクの状態

| ID | 状態 |
|---|---|
| BASE-1 業務範囲・初回機能 | 本書で提案。**ユーザーの確定待ち** |
| BASE-2 構成・配布準備 | 調査完了（§4）。実装は未着手 |
| BASE-3 iPad・スマホのプレビュー | 未着手。プレビュー方式（§5）が前提 |
| BASE-4 初回機能とAPI・認可 | 未着手 |
| BASE-5 実機検証・内部配布 | 未着手 |
