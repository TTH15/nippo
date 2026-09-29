# ハコ虎 — ドライバー用ネイティブアプリ

Expo SDK 57 / React Native 0.86 / React 19.2.3。iOS/Android識別子は `jp.hakotora.app`。
認証/APIは `@repo/core`、端末の認証保存はSecureStore。vendorの `packages/auth` / `packages/api-client` は直接編集しない。

## EASの紐付け（2026/09/21）

- project: [@next-eight/hakotora](https://expo.dev/accounts/next-eight/projects/hakotora)
- UUID: `c874c3eb-642e-4670-8706-31e47e821d76`
- `app.json` にowner/project IDを保存済み。通常はEAS_PROJECT_*環境変数の指定不要。
- Expoプラグイン追加・EAS CLI 24.7.0のブラウザ認証・init/project:info照合済み。既存 `apps/mobile` を利用し、新規ひな形は作成していない。
- 署名資格情報、Apple Team/UDID、サーバーAASA/DALの公開、EASビルド・配布は未実施。

## ローカル検証

リポジトリルートで実行する。

```sh
npm run typecheck -w @repo/mobile
npm run test -w @repo/mobile
npm run check:release -w @repo/mobile
npm run preview:isolated -w @repo/mobile -- --port 3201
```

プレビュー: `http://127.0.0.1:3201/preview/admin/mobile`。`screen=login|settings|parking`、`scenario=normal|empty|long-name|loading|error|cancel|unsupported|nofactor`。
SMSの架空コードは `123456`。通常ログイン・キャンセル→再試行、SMS→設定、鍵追加/削除・再本人確認、位置なしの日報完了を試せる。

`LoginScreen` / `PasskeySettings` / `ParkingChoice` の本番RNコードをDOMアダプターで表示。色・ロゴ・文言・状態遷移を再利用する。API/認証保存/OS Passkeyはメモリ内fixture、CSPで通信を遮断する。RNの実レイアウト、OSダイアログ、実SMS、署名、実GPS、退勤API/日報APIの成立はこのブラウザプレビューでは検証できない。

## 開発ビルドと環境

画面調整は `npm run dev:ui -w @repo/mobile` で隔離モードを起動し、Expo Go/シミュレーターへFast Refreshで反映する。本番画面を架空データで表示し、本番API・認証保存・Passkey/GPS/OCRから隔離する。[接続・サインイン・再起動手順](../../docs/development/mobile-fast-refresh.md)を参照。

Passkey・OCR等の実機能検証にはdev buildを使う。
`npm run start -w @repo/mobile`。ネイティブ依存やAssociated Domains変更後は再ビルドが必要。

| 環境変数 | 用途 |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | 手元開発のAPI。未指定は `https://hakotora.jp`。非開発ビルドはHTTPS必須 |
| `EXPO_PUBLIC_PASSKEY_ENABLED` | `true` の新ビルドでPasskey UIを有効化。未設定時はSMS |
| `EAS_PROJECT_ID` / `EAS_PROJECT_OWNER` | 別の承認済みExpoプロジェクトへの明示上書き用。通常はapp.jsonの確定値を使う |
| `EAS_PROJECT_SLUG` | 既定候補 `hakotora`。既存projectへ紐付ける場合はそのslug |
| `APPLE_TEAM_ID` | 確認済みの署名Team ID。未確認のローカル候補を自動採用しない |

EAS各profileのAPIは現状 `https://hakotora.jp`。development環境も本番へ書き込むため、架空データを送信しない。隔離プレビューには環境ファイルを読ませない。会社コードは現行ログインでは使わず、任意テナントの認可には使用しない。

## OTA更新（ローカル設定済み・未公開）

`expo-updates` をSDK 57互換で追加。`app.config.ts` は紐付け済みprojectの更新URLと `fingerprint` runtimeを生成し、`eas.json` はdevelopment/preview/productionのchannelを分離する。
起動時に非同期取得し、取得した更新は次のコールド起動で反映する。アプリを閉じずに復帰しただけでは反映を保証しない。業務中の強制リロードは追加しない。

更新対象は互換性のあるJS・アセット。ネイティブ依存・権限・Associated Domainsの変更は新しい署名ビルドが必要。EASへの公開は未実施で、channelの存在/接続も初回ビルド時に確認する。

OTA公開は対象差分と環境を確認し、承認後に実行する。ビルドの `eas.json` 内の `env` はOTA公開に自動適用されないため、EAS preview環境のAPI URL・Passkeyフラグ・必要ならAPPLE_TEAM_IDをビルドと揃える。古いignored iosを含まない配布用チェックアウトから実行し、生成runtimeを配布済みビルドと照合する。

公開環境を読み込んだシェルで `npm run check:release -w @repo/mobile -- --ota --platform android` を先に実行する。API/Passkeyフラグが未設定またはビルドと不一致なら失敗する。`.env` はこのチェックへ自動読込しない。EAS project/owner/slugも今回の確定値と照合する。iOS配布時は `--release` を加えてTeamも確認する。

```sh
# previewへの公開が承認され、EAS preview環境を照合した後のみ
npx eas-cli@latest update --channel preview --environment preview --message "確認済み変更の説明"
```

## 配布前に確定する項目

### 未コミット差分を保ったまま配布候補を選別する

リポジトリルートで、まだ存在しないリポジトリ外のディレクトリを指定する。

```sh
node scripts/prepare-mobile-release.mjs /tmp/hakotora-mobile-candidate
```

`source/` にmobile・変更のない共有packages・npm workspaceの依存解決用package.json・lockfile・配布前チェック/画面確認起動スクリプトをコピーする。ルートpackage.jsonはHEADへmobileと同版のRN/Reanimated/Worklets overridesだけを加え、他作業のroot script変更を混ぜない。BaseのRN同版化だけも許可する。他アプリのソース、Webの未公開差分、DB、`.env*`、秘密鍵、古いios/android、node_modulesは含めない。共有packagesや、それ以外の他アプリmanifest差分があれば止まる。既存出力先は上書きしない。

隣の `manifest.json` に基点commit・選別差分・各ファイルのSHA-256を保存する。これはモバイル専用の候補で、WebやBaseのビルドには使わない。mobile配下の変更は全て対象になるため、manifestの選別差分は公開承認前にレビューする。作業コピーをGitへcommit/pushする処理は含まない。

`source/` で `npm ci` とmobileの検証を実行する。EASの実際の送信対象をアップロードせずに確認する場合、`source/apps/mobile` で次を実行する（rootは生成時の絶対パスを指定）。

```sh
EAS_NO_VCS=1 EAS_PROJECT_ROOT=/tmp/hakotora-mobile-candidate/source \
  npx eas-cli@latest build:inspect --platform android --profile preview \
  --stage archive --output /tmp/hakotora-mobile-archive
```

`--stage archive` だけが今回の対象。`pre-build` / `post-build` は署名などの処理へ進むため同じ扱いにしない。検証用コピーでprebuildした後のネイティブ生成物を配布元へ戻さない。

Expo未作成の場合は [初回アカウント作成・ad hoc配布の手順](../../docs/deployment/mobile-internal-first-build-2026-09.md) から進める。iOS初回はad hocで合意済み。

[設計・復旧・承認単位](../../docs/design/mobile-passkey-distribution-2026-09.md) を正本とする。

1. Expoの所有者・既存project、Appleの契約/Team/App ID prefix、Android APK署名証明書を照合する。
2. サーバー側 `WEBAUTHN_RP_ID=hakotora.jp` / `WEBAUTHN_ORIGIN=https://hakotora.jp`、`PASSKEY_APPLE_APP_ID`、`PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS` を確定する。後者2つは関連付け用の公開識別情報だが、設定変更は承認後。
3. AASA/DAL・サーバーorigin対応を先行公開し、200/JSON/redirectなしを確認する。新規招待必須化も公開する場合はmigration 183を先に適用する。
4. dirty treeを一括送信せず、今回の対象差分を選別した新規チェックアウトから `npm ci`。ignoredな旧ios/Podsを再利用しない。
5. `npm run check:release -w @repo/mobile -- --release` でproject/owner/Teamの不足を確認する。これは外部署名/契約の検証を代行しない。

以下は**対象と影響への承認を得た後**に `apps/mobile` で実行する。今セッションでは未実行。

```sh
eas project:info
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

preview: AndroidはAPK、iOSはad hoc（対象UDIDが必要）。TestFlight/Play内部テストはproductionのstoreビルドから提出する別作業。`submit.production` の宛先・資格情報は未設定。EAS version管理はremote/autoIncrementを維持し、初回番号はproject照合時に確認する。

2026/09/23: 選別コピーのnpm ci・mobile型検査・14テスト・両OS prebuild・署名なしiOS実機向けReleaseコンパイルに成功。承認済みEAS preview環境2変数を保存し、同環境でOTAチェックも成功。iOSシミュレーターは既存OCR依存のarm64除外で失敗。Androidネイティブコンパイル・両OSの署名配布・PasskeyのOS画面・実機の駐車送信・OTA実機反映は未検証。PIN停止・既存利用者の強制ログアウト・DB適用・一般公開・OTA公開は行っていない。
