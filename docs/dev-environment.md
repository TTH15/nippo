# 開発環境（dev / staging）セットアップ

本番（nippo-ace / 本番 Supabase）を汚さずに、仮登録→承認→本登録→利用開始や
車両QRなど**書き込み系**を開発・検証するための独立環境。

## 構成
- **dev DB**: 独立した Supabase クラウドプロジェクト（本番とは別）。
- **dev API**: ローカル `npm run dev`（Next）が dev DB を指す。mobile は Mac の LAN IP を叩く。
- **（後段）staging**: 物理デバイス/QR 検証用に Vercel staging（dev DB 指定）＋デバイス dev ビルド。

---

## 手順 A：dev Supabase プロジェクトを作る（ダッシュボード作業＝あなた）
1. https://supabase.com/dashboard で **New project**（名前例 `nippo-dev`、本番と別 org/プロジェクト）。
2. 以下を控える：
   - **Project URL**: `https://<ref>.supabase.co`（Settings → API）
   - **service_role key**（Settings → API → Project API keys → `service_role`、秘匿）
   - **DB 接続文字列**（Settings → Database → Connection string → **Session pooler** を選択）
     例: `postgresql://postgres.<ref>:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres`
     ※直結 `db.<ref>.supabase.co:5432` は IPv6 で届かない環境があるため **pooler** を使う。

## 手順 B：env を設定（`apps/web/.env.local`・gitignore 済）
```
# dev Supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_DB_URL=postgresql://postgres.<ref>:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres

# 認証
JWT_SECRET=<任意の十分長いランダム文字列>

# 表示用の会社コード（当面 ACE）
NEXT_PUBLIC_COMPANY_CODE=ACE
```

## 手順 C：migration を一括適用 ＋ seed（私が実行可）
```
npm run db:migrate     # supabase/migrations/001〜最新 を dev DB に冪等適用
npm run seed           # テスト用 org/ドライバーを投入（seed.ts / seed-full.ts）
```
- `db:migrate` は `SUPABASE_DB_URL` を使い、`apply-migrations.ts` が全 .sql を番号順に流す。冪等。
- seed 後、organizations に ACE 等のテナント＋ドライバー（driver_code＋初期PIN）が入る。

## 手順 D：dev サーバ＋mobile 配線
```
npm run dev            # http://localhost:3000（LAN では http://<MacのLAN IP>:3000）
```
`apps/web/.env.local` の dev DB を指したまま起動。
mobile（`apps/mobile/.env`）を dev に向ける：
```
EXPO_PUBLIC_API_BASE_URL=http://<MacのLAN IP>:3000   # 例 http://192.168.0.12:3000
EXPO_PUBLIC_COMPANY_CODE=ACE
```
→ シミュレータ/実機（同一 Wi-Fi）から dev API 経由で dev DB に書き込める＝本番に影響しない。

---

## 後段で必要になるもの（その都度準備）
- **SMS OTP**（仮登録の電話検証）: プロバイダ（Twilio 等）アカウント＋API キー＋従量課金。
- **車両QR**（カメラ）: **物理 iPhone** 必須（シミュレータにカメラなし）＝デバイス dev ビルド（Apple 署名）＋ staging or LAN の dev サーバ。
- **Vercel staging**: dev DB を指す別デプロイ（物理デバイスからの安定 URL・チーム共有用）。

## 注意
- `SUPABASE_DB_URL` / `service_role key` は秘匿。`.env.local` は gitignore 済（コミットしない）。
- `db:migrate` は **dev/staging 専用**。本番には流さない（制約系 migration が実行時 INSERT を弾きうるため、本番は従来の慎重運用）。
