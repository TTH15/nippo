# nippo

配送業務向けの業務管理アプリです。  
ドライバー向けの日報提出だけでなく、管理者向けに売上管理・請求書作成・車両管理・シフト管理・諸報告承認までをカバーしています。

## リポジトリ構成（monorepo）

npm workspaces による monorepo です。ネイティブ（Expo）化と基盤移行を見据え、プラットフォーム非依存のコア層を独立パッケージへ切り出しています。

```
<repo>/
├─ apps/
│  └─ web/          Next.js アプリ（@repo/web）— UI・API ルート・サーバ層
├─ packages/
│  └─ core/         共有コア層（@repo/core）— 型・認証・APIクライアント・純粋ロジック（UI/DOM 非依存）
├─ supabase/        DB マイグレーション
├─ docs/            設計・移行ドキュメント
└─ package.json     workspaces ルート（scripts は各ワークスペースへ委譲）
```

- `@repo/core` は TS ソースのまま消費します（ビルド不要。Next の `transpilePackages` でトランスパイル）。subpath: `@repo/core/types` `@repo/core/auth` `@repo/core/api` `@repo/core/logic/*`。
- 将来 `apps/mobile`（Expo）が同じ `@repo/core` を import する想定です。
- 移行の経緯と手順は `docs/monorepo-migration-step0.md` を参照。

## 現在の主な機能

- ドライバー: 日報提出、履歴確認、シフト確認、報酬確認
- 管理者: 売上集計/ログ、日報承認、その他報告承認、ドライバー管理
- 管理者: 車両管理、コース管理、取引先管理、請求書作成/保存/プレビュー
- ロール: `DRIVER` / `ADMIN` / `ADMIN_VIEWER`（閲覧専用管理者）
- 認証: JWT（`jose`）+ bcrypt ハッシュ照合

## 技術スタック

- Next.js 15 (App Router) + TypeScript
- React 18 + Tailwind CSS
- Supabase (Postgres)
- SWR / Recharts / Font Awesome / Radix UI

## セットアップ

### 1. 依存インストール

```bash
npm install
```

### 2. 環境変数を作成

Web アプリ配下 `apps/web/.env.local` を作成し、以下を設定してください（Next はアプリのディレクトリ基準で env を読みます。Vercel では Root Directory=`apps/web` のうえでダッシュボードに設定）。

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
NEXT_PUBLIC_COMPANY_CODE=ACE
```

- `SUPABASE_URL`: Supabase プロジェクトURL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase の Service Role キー
- `JWT_SECRET`: JWT 署名鍵（十分に長いランダム文字列）
- `NEXT_PUBLIC_COMPANY_CODE`: 会社設定の切り替え（`ACE` または未指定でデフォルト）

### 3. DB マイグレーション適用

`supabase/migrations`（リポジトリルート）配下の SQL を先頭から順に適用してください。  
初期導入時は `001_init.sql` だけでなく、最新番号まで全て必要です。

### 4. 初期データ投入（任意）

```bash
npm run seed
```

大きめの検証データが必要な場合は以下を実行します（スクリプトは `@repo/web` 配下で実行）。

```bash
npm -w @repo/web exec -- tsx src/scripts/seed-full.ts
```

### 5. 管理者アカウント作成（任意）

```bash
npm -w @repo/web exec -- tsx src/scripts/create-admin.ts --adminCode ACE8888 --password "your-password" --name "管理者"
```

閲覧専用管理者を作る場合:

```bash
npm -w @repo/web exec -- tsx src/scripts/create-admin.ts --adminCode ACE9999 --password "viewer-pass-123" --name "閲覧専用" --readonly
```

### 6. 起動

```bash
npm run dev
```

`http://localhost:3000` にアクセスしてください。

## 主要画面

### 共通

- `/` : ロールに応じて自動リダイレクト
- `/login` : ドライバーログイン
- `/admin/login` : 管理者ログイン

### ドライバー

- `/submit` : 日報提出
- `/me` : 自分の日報履歴
- `/shifts` : 自分のシフト
- `/me/rewards` : 報酬確認

### 管理者

- `/admin/sales` : 売上（アナリティクス/集計/ログ）
- `/admin/daily` : 日報報告（承認/差戻し）
- `/admin/misc-reports/others` : その他の報告（オイル交換など）
- `/admin/users` : ドライバー管理
- `/admin/shifts` : シフト管理
- `/admin/payments` : ペイメント確認
- `/admin/vehicles` : 車両管理
- `/admin/courses` : コース管理
- `/admin/counterparties` : 取引先管理
- `/admin/invoices` : 請求書管理
- `/admin/invoices/new` : 請求書新規作成
- `/admin/invoices/addressbook` : 請求先アドレス帳

## API（主要カテゴリ）

詳細は `apps/web/src/app/api` を参照してください。

- 認証: `/api/auth/login`
- ドライバー日報: `/api/reports`, `/api/reports/me`, `/api/reports/day`
- ドライバー情報: `/api/reports/profile`, `/api/reports/vehicles`, `/api/reports/vehicle-preference`
- ドライバー向け参照: `/api/me/shifts`, `/api/me/rewards`, `/api/me/invoices`
- 管理（日報）: `/api/admin/daily/*`
- 管理（売上）: `/api/admin/sales/*`
- 管理（請求）: `/api/admin/invoices/*`, `/api/admin/invoice-addresses/*`
- 管理（マスタ）: `/api/admin/users/*`, `/api/admin/vehicles/*`, `/api/admin/courses/*`
- 管理（取引先/支払）: `/api/admin/counterparties/*`, `/api/admin/payments/*`

## npm scripts

- `npm run dev`: 開発サーバー起動
- `npm run build`: 本番ビルド
- `npm run start`: 本番モード起動
- `npm run seed`: 最小シード投入

いずれもリポジトリルートで実行でき、`@repo/web` へ委譲されます。

## 認証と権限

- `DRIVER`: 提出・自分の情報参照
- `ADMIN`: 全管理機能（作成/更新/承認）
- `ADMIN_VIEWER`: 管理画面の閲覧中心（書き込み制限あり）

認証プロバイダの型は `apps/web/src/server/auth/types.ts`、JWT実装は `apps/web/src/server/auth/jwt.ts` です。  
プラットフォーム非依存の認証コア（トークン保持・apiFetch）は `@repo/core/auth` / `@repo/core/api` にあり、Web は `apps/web/src/lib/api.ts` 経由で利用します。

## 補足

- 会社情報は `apps/web/src/config/companies.ts` で切り替えます。
- 管理画面トップ (`/admin`) は現在 `/admin/sales` へリダイレクトします。
