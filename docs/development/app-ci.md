# アプリCI

`.github/workflows/app-ci.yml` はWeb・共有パッケージ・モバイルの回帰検査を行う。GitHub Pagesの `pages-build-deployment` とは別のチェック。

## 実行条件と内容

- mainへのpull request、mainへのpush、初回同期用の `codex/main-sync-ci-*` ブランチへのpush、手動実行で起動する。
- Ubuntu / Node.js 24（本番Vercelと同じメジャー版）で、ルートのlockfileから `npm ci` する。
- `npm run typecheck`: Next.jsのルート型を生成し、Web・隔離プレビュー・モバイルを検査する。プレビューはWebと同じTypeScriptを使う。
- `npm run test -w @repo/web -- --maxWorkers=2`: Webと `@repo/core` の単体・コンポーネント・APIモックのテストを実行する。
- `npm run check:tenant`: migrationから会社列を持つテーブルを抽出し、会社境界の静的検査を実行する。
- `npm run build`: Next.jsの本番ビルドを検査する。

公式の [checkout](https://github.com/actions/checkout) と [setup-node](https://github.com/actions/setup-node) を検証したコミットに固定し、トークンは読み取りのみ、checkout後の認証情報保持は無効にする。

## 本番からの隔離と検査範囲

CIに本番の環境ファイルや秘密値を渡さない。ビルド時のSupabase初期化にはループバックの未使用ポートと架空キーを渡す。DBへの読み書き、migration適用、通知送信、Vercelへの公開はCIから実行しない。DB接続が必要な `test:itest` は通常CIに含めず、専用DBで別途検証する。

CI成功は、実機のカメラ・認証・配布、ブラウザ操作、実PNG/PDFの品質を確認した意味ではない。UI改修時の隔離プレビューと実ファイル監査は引き続き必要。

mainへのGit同期はVercelの既存Git連携によって本番ビルドを起動し得る。公開済みコードを基点に同期し、CI・Vercelの両方を確認する。App CI自体には公開処理も本番を止める権限もなく、チェック追加だけでmainの必須チェックやVercelの公開待機が自動設定されるわけではない。
