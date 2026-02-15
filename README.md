# 日報集計MVP

配送業者向けの日報集計Webアプリ（Next.js + Supabase）。  
将来のLINE LIFF化に対応した認証設計。

## 技術スタック

- **Next.js** (App Router) + TypeScript
- **TailwindCSS**
- **Supabase** (Postgres)
- **jose** (JWT署名・検証)
- **bcryptjs** (PIN ハッシュ化)

## セットアップ

### 1. 依存インストール

```bash
npm install
```

### 2. Supabase プロジェクト作成

Supabase ダッシュボードで新規プロジェクトを作成し、SQL Editor で以下を実行:

```
supabase/migrations/001_init.sql
```

### 3. 環境変数

`.env.local.example` をコピーして `.env.local` を作成:

```bash
cp .env.local.example .env.local
```

以下を設定:

| 変数 | 説明 |
|------|------|
| `SUPABASE_URL` | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role キー（Settings > API） |
| `JWT_SECRET` | 任意の32文字以上の秘密鍵 |

### 4. シードデータ投入

```bash
npm run seed
```

デフォルトのログインPIN:
- 管理者: `9999`
- 田中太郎: `1111`
- 佐藤花子: `2222`
- 鈴木一郎: `3333`

### 5. 起動

```bash
npm run dev
```

http://localhost:3000 にアクセス

## ページ一覧

| パス | 説明 | ロール |
|------|------|--------|
| `/login` | PINログイン | — |
| `/submit` | 日報送信（数字4つ） | DRIVER |
| `/me` | 自分の提出履歴 | DRIVER |
| `/admin` | 日別一覧・未提出確認 | ADMIN |
| `/admin/monthly` | 月次集計・CSV出力 | ADMIN |

## API

| エンドポイント | メソッド | 認証 | 説明 |
|---------------|---------|------|------|
| `/api/auth/login` | POST | — | PIN → JWT発行 |
| `/api/reports` | POST | DRIVER | 日報送信（Upsert） |
| `/api/reports/me` | GET | DRIVER | 自分の履歴 |
| `/api/admin/daily` | GET | ADMIN | 日別一覧 |
| `/api/admin/monthly` | GET | ADMIN | 月次集計 |
| `/api/admin/monthly.csv` | GET | ADMIN | CSV出力 |

## 認証の差し替え（LINE LIFF化）

`src/server/auth/jwt.ts` の `authProvider` を `LineIdTokenAuthProvider` に差し替えるだけでOK:

```typescript
export const authProvider = new LineIdTokenAuthProvider();
```

`AuthProvider` インターフェースは `src/server/auth/types.ts` に定義済み。

## イベント拡張

`src/server/events/listeners/dailyReportSubmitted.ts` に以下のスタブが用意済み:

- `renderDailyReportImage()` — 画像生成（LINE投稿用）
- `postToLineGroup()` — LINEグループへの投稿

日報送信後に `setImmediate` で非同期実行されるため、APIレスポンスには影響しません。
