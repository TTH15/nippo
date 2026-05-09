# nippo-mvp

配送業務向けの業務管理Webアプリです。  
ドライバー向けの日報提出だけでなく、管理者向けに売上管理・請求書作成・車両管理・シフト管理・諸報告承認までをカバーしています。

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

プロジェクトルートに `.env.local` を作成し、以下を設定してください。

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

`supabase/migrations` 配下の SQL を先頭から順に適用してください。  
初期導入時は `001_init.sql` だけでなく、最新番号まで全て必要です。

### 4. 初期データ投入（任意）

```bash
npm run seed
```

大きめの検証データが必要な場合は以下を実行します。

```bash
npx tsx src/scripts/seed-full.ts
```

### 5. 管理者アカウント作成（任意）

```bash
npx tsx src/scripts/create-admin.ts --adminCode ACE8888 --password "your-password" --name "管理者"
```

閲覧専用管理者を作る場合:

```bash
npx tsx src/scripts/create-admin.ts --adminCode ACE9999 --password "viewer-pass-123" --name "閲覧専用" --readonly
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

詳細は `src/app/api` を参照してください。

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

## 認証と権限

- `DRIVER`: 提出・自分の情報参照
- `ADMIN`: 全管理機能（作成/更新/承認）
- `ADMIN_VIEWER`: 管理画面の閲覧中心（書き込み制限あり）

認証プロバイダの型は `src/server/auth/types.ts`、JWT実装は `src/server/auth/jwt.ts` です。

## 補足

- 会社情報は `src/config/companies.ts` で切り替えます。
- 管理画面トップ (`/admin`) は現在 `/admin/sales` へリダイレクトします。
