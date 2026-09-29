# 公開状態とローカル統合の境界（2026/09/29）

## 確認した公開基点

- 2026/09/29の確認時、GitHub `origin/main` は `b7dc455a4512d614f11d35ddfc7058dc5faa4fac`。本番 `hakotora.jp` はVercel `nippo-ace` のREADY deployment `dpl_2rRcDJwVHsXwF7RSKNrLPL5qJtAC`（同じGit SHA）を配信していた。
- 共有シフトメモのmigration 184、会社別撮影設定のmigration 185は作業ログに本番適用の記録がある。このセッションではSupabase CLIのproject refリンクがなく、DBの現在値を直接照合できていない。
- EAS `@next-eight/hakotora` の `build:list --platform all` は空配列。署名済みのモバイルビルドや実機認証・配布は確認できていない。

## 今回のローカル統合

元の作業ツリーは `main` の `1259eb6` 上に未コミットの差分が多数あった。これを公開済み `origin/main` の上へ移し、Web、モバイル、デザイン画像、設計・作業記録の4コミットとして整理した。別ブランチのドライバー担当コースAPI検査も統合し、ローカル `main` に反映した。元の差分と公開済み4コミットで重なるファイルは照合し、同一内容であることを確認した。

| 対象 | ローカルGit | 本番・配布 |
| --- | --- | --- |
| ネイティブPasskey、EAS/OTA設定、モバイル画面 | コミット済み | EASビルド・署名・実機確認・配布は未実施 |
| 単回招待からのPasskey必須化とmigration 183 | コミット済み | DB 183の適用とWeb公開は未実施。公開順はDB→Web |
| 管理画面・地図・撮影・位置送信の追加変更 | コミット済み | 今回の追加差分は本番未公開 |
| 担当コースIDの会社所属API検査 | コミット済み | 本番未公開。DB側の保証と実DB結合テストは別工程 |
| 認証・会社境界の監査設計 | コミット済み | [監査と設計](mobile-auth-and-boundaries-2026-09.md)を参照 |

`main` のローカル統合とGitHubへのpush・Vercelの本番配信は別の状態として扱う。migration 183の本番適用を確認する前に、これに依存するWeb差分を本番へ送らない。

## 次の認証作業

1. 担当コースのDB側同一会社保証を、PostgRESTの既存結合を壊さず検証する。
2. 通常・管理・復旧のセッション用途をサーバーで区別し、SMSだけのセッションから管理APIへ入れないようにする。
3. 既存アカウントのPasskey追加・復旧と振込先変更を、用途別の再確認・通知・監査で保護する。
4. モバイルのSecureStore保存・削除の完了待ちを実装し、署名済み実機でPasskey・復旧・旧アプリからの移行を検証する。

## 確認方法

Gitは `git fetch origin main` とコミット・ファイル照合、Vercelは `vercel ls nippo-ace --environment production` と `vercel inspect hakotora.jp`、EASは `build:list` を使用した。Supabase CLIの `migration list --linked` はproject ref未設定で実行できなかった。今回のコード確認は型検査、Web・モバイルテスト、会社境界静的検査、検証用環境値でのWebビルドを使用した。
