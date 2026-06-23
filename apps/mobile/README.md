# @repo/mobile — Nippo ドライバーアプリ（Expo）

ドライバー UI の React Native 化に向けた足場。ビジネスロジック/認証/API は
`@repo/core`（Web と共有）を import し、UI だけ RN で実装する。

- **Expo SDK 52 / React 18.3**（Web の React 18.3 と整合＝npm workspace で単一 React）。
- 認証は `@repo/core/auth`、API は `@repo/core/api` を起動時に注入（`src/bootstrap.ts`）。

## 開発の前提：Expo Go ではなく「開発ビルド（dev build）」を使う

Expo Go は最新 SDK 専用のため、本プロジェクト（SDK 52）は Expo Go では動かない。
代わりに SDK を埋め込んだ **開発ビルド**（`expo-dev-client`）を使う。一度作れば、
以後は `npm run -w @repo/mobile start`（= `expo start --dev-client`）でその端末に
JS を流し込んで開発できる。

### 1. 環境変数
`apps/mobile/.env`（`.env.example` をコピー）:

```
EXPO_PUBLIC_API_BASE_URL=https://nippo-ace.vercel.app   # 末尾スラッシュ不要
EXPO_PUBLIC_COMPANY_CODE=ACE
```

> 開発で日報提出など**書き込み系**を試すときは、ローカル dev サーバ（`npm run dev`）の
> LAN IP（例 `http://192.168.x.x:3000`）を指す方が安全（本番 DB を汚さない）。
> ログインのみの疎通確認なら本番 URL でも可（非破壊）。

### 2-A. ローカルで開発ビルド（要 Xcode / Android Studio）
```
npm install
npm run -w @repo/mobile run:ios       # iOS シミュレータ/実機（Xcode 必須）
# または
npm run -w @repo/mobile run:android   # Android（Android Studio 必須）
```
`expo run:*` がネイティブプロジェクトを生成・ビルドして dev client を端末へインストールする。

### 2-B. クラウドで開発ビルド（Xcode 不要・要 Expo アカウント）
```
npm i -g eas-cli
eas login
eas init                              # extra.eas.projectId を設定
eas build --profile development -p ios     # or -p android
```
完成したビルドを端末にインストール後、`npm run -w @repo/mobile start` で接続。

### 3. 動作確認
既存ドライバーコード（会社コード + 数字6桁）＋ PIN でログイン → 名前表示。

## メモ
- app 名 / bundleId（`com.example.nippomobile`）は**仮**。ブランド確定後にリネーム。
- EAS 本番ビルド・ストア提出・Passkey 用 associated domains は後続。
