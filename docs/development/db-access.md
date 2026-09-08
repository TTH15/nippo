# DB に直接つなぐ（読み取り・migration 適用）

CLI とエージェントから本番／開発の Postgres を直接触るための手順。
**既定は読み取り専用**で、書き込みは明示的な確認語が要る形にしてある。

前提: `psql`（PostgreSQL 18 系）がローカルに入っていること。`psql --version` で確認。

## 1. 接続情報を置く

Supabase ダッシュボード → 対象プロジェクト → **Settings → Database → Connection string**
→ **Session pooler**（ポート 5432）の文字列をコピーする。直結の `db.<ref>.supabase.co:5432` は
IPv6 でしか引けない環境があるため使わない。

`apps/web/.env.dbadmin` を作って次の形で書く（`.env*` は gitignore 済み）。

```
# 本番 Supabase（ref: ooirajiizydcynyglvuv）
DB_URL_PROD=postgresql://postgres.<ref>:<DB_PASSWORD>@aws-1-<region>.pooler.supabase.com:5432/postgres

# 任意: ローカル supabase や検証用プロジェクト
DB_URL_DEV=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

パスワードが分からない場合は同じ画面の **Database password → Reset** で再発行する
（既存のアプリは service_role キー経由なので、DB パスワードの再発行では止まらない）。

`apps/web/.env.local` の `SUPABASE_DB_URL` は**別プロジェクトを指したまま死んでいる**
（2026-09-08 に接続タイムアウトを確認）。`npm run db:migrate` は `.env.development.local` しか
読まない dev 専用ランナーなので、本番用の接続はこの `.env.dbadmin` に分けて置く。

## 2. 読む

```bash
scripts/db/db.sh q "select count(*) from vehicles"     # 表で表示
scripts/db/db.sh qcsv "select id, name from carriers"  # CSV
scripts/db/db.sh qf scripts/db/audit/s1-anon-grants.sql
scripts/db/db.sh psql                                   # 対話（読み取り専用）
```

これらは `default_transaction_read_only=on` のセッションで走るので、
うっかり `UPDATE` を書いてもサーバー側で弾かれる。

## 3. migration を適用する

```bash
scripts/db/db.sh status                       # 台帳と supabase/migrations の差分
scripts/db/db.sh dryrun supabase/migrations/159_xxx.sql          # BEGIN … ROLLBACK で試す
scripts/db/db.sh apply  supabase/migrations/159_xxx.sql --confirm=159_xxx.sql
```

`apply` は 1 トランザクションで流し、成功したら `_migrations` 台帳に記録する。
台帳は本番にはまだ無い（これまで SQL Editor で手動適用してきたため）。
`status` の一覧は「台帳に無い」だけで「未適用」とは限らないので、**初回は実スキーマを見て**
適用済みかどうかを判断する。

金額や認証に触る migration（152 など）は、適用前に影響行数を読み取りで数え、
戻し手順を書いてから。本番の書き込みテストはしない。

## 4. ローカルで試したいとき（任意・OrbStack）

`supabase start` でローカルに Postgres + PostgREST 一式が立つ（Docker が要る。初回は数 GB の
イメージ取得）。REVOKE のように**本番のアプリを壊しうる migration** は、ここで
`DB_URL_DEV` に対して先に流し、画面の動作を見てから本番に入れる。

```bash
supabase start
HAKOTORA_DB_TARGET=dev scripts/db/db.sh apply supabase/migrations/159_xxx.sql --confirm=159_xxx.sql
```

## 安全のための約束

- 本番へは原則読み取りだけ。書き込みは `apply` / `write` の確認語つきでのみ。
- 金額が動く操作は先に dry-run で金額を出す（2026-08 の教訓）。
- 接続文字列と service_role キーはコミットしない。ログや issue にも貼らない。
