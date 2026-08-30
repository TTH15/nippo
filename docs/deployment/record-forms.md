# 記録・報告のリリース手順

2026-08-31。**実装・開発DB検証まで完了。本番DBと本番サイトは未変更。**

## 対象と影響

- 本番: Vercel `nippo-ace` / `hakotora.jp` / root `apps/web`。
- ローカル `.vercel/project.json` は開発用 `hakotora-dev`。通常の `vercel --prod` をそのまま実行しない。
- 新規DB変更は **154_org_record_forms.sql のみ**。既存レコードの変換、売上・報酬・口座・シフトへの書き込みなし。
- 固定項目版153は `docs/design/archive/` に退避済み。本番へ適用しない。一括 `db:migrate` は使用しない。
- 本番の新規フォームは0件。管理者が「フォーム管理」でテンプレートを選択・編集して作成する。ドライバー公開と他ロールの利用は初期状態でオフ。

## 完了済み

- Web84ファイル796テスト・型チェック成功。

- 共通コンポーネントによるフォーム管理、記録一覧・登録・編集・追記、本人向け画面。
- サーバー認証・org分離、ロール別アクセス、本人限定取得、運営専用メモ除外、同時編集の409、保存失敗時の入力保持。
- 開発DB（`.env.development.local`）へ154を適用済み。実際の認証／Supabase REST／RPCを通した15検証に成功。検証組織・記録・メンバーを削除済み。
- PGliteの独立PostgreSQLで26検証。既存テストDB設定は削除済み接続先を指していて利用不可。開発DBで代替確認した。
- 本番用 `next build --webpack` 成功。既存の地図APIの不要な `normalizeRadius` exportを削除（処理は不変）。Turbopackはローカルで完了しなかったため停止した。

## 本番反映前の確認

1. 本番プロジェクトのSupabase接続先と、適用対象DBを照合する。**秘密情報の全量ダウンロードはしない**。必要な接続情報だけを安全に扱う。
   今回 `vercel env pull` は本番の秘密情報をローカルへ複製するため、自動安全審査で拒否された。代替経路で取得せず、接続情報の扱いについて明示承認待ち。
2. 本番DBで154の適用状況を読み取り確認する。既に存在する場合は定義を照合し、無条件に上書きしない。
3. 154を単独のトランザクションで適用する。`lock_timeout = '5s'`、`statement_timeout = '60s'` を設定し、失敗時は全体をROLLBACK。
   COMMIT時に `NOTIFY pgrst, 'reload schema'`。マイグレーション台帳を使う環境では同ファイルの適用を記録する。
4. レビュー済み差分だけをmainへ反映し、`nippo-ace` のデプロイを確認する。ローカルの無関係な未コミット変更を混ぜない。
5. 本番ではダミーデータをseedせず、ログイン必須・権限なし拒否・管理者の空フォーム一覧の読み取りを確認する。ユーザー自身が最初のフォームを作成する。

## 差し戻し

アプリを直前のデプロイに戻す。追加4テーブルは残す（新しい記録が入力された後にDROPしない）。既存の日報・会計・シフトへの移行がないため逆変換は不要。

## 再検証

- `npm test --workspace=@repo/web`
- `npm run build --workspace=@repo/web -- --webpack`
- ローカルSQL: PGlite 0.5.8を一時ディレクトリへインストールし、`RECORDS_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node apps/web/src/scripts/checks/record-forms-sql.mjs`。
- 開発DB: `RECORDS_DEV_ACCEPTANCE=1 node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json apps/web/src/scripts/checks/record-forms-dev.mts`。本番との接続先一致を拒否し、検証用組織はfinallyで削除する。開発用154の再適用を伴う。
