# 公開状態とローカル統合の境界（2026/09/29）

## 確認した公開基点

- 今回の公開前、GitHub `origin/main` は `b7dc455a4512d614f11d35ddfc7058dc5faa4fac`。本番 `hakotora.jp` はVercel `nippo-ace` のREADY deployment `dpl_2rRcDJwVHsXwF7RSKNrLPL5qJtAC`（同じGit SHA）を配信していた。
- 本番DBへ読み取り専用で接続し、移行183の列と台帳が未作成であることを確認した。移行184・185の台帳記録も直接確認した。
- EAS `@next-eight/hakotora` の `build:list --platform all` は空配列。署名済みのモバイルビルドや実機認証・配布は確認できていない。

## 今回のローカル統合

元の作業ツリーは `main` の `1259eb6` 上に未コミットの差分が多数あった。これを公開済み `origin/main` の上へ移し、Web、モバイル、デザイン画像、設計・作業記録の4コミットとして整理した。別ブランチのドライバー担当コースAPI検査も統合し、ローカル `main` に反映した。元の差分と公開済み4コミットで重なるファイルは照合し、同一内容であることを確認した。

| 対象 | ローカルGit | 本番・配布 |
| --- | --- | --- |
| ネイティブPasskey、EAS/OTA設定、モバイル画面 | GitHub `main` に反映 | EASビルド・署名・実機確認・配布は未実施 |
| 単回招待からのPasskey必須化とmigration 183 | GitHub `main` に反映 | DB 183を適用し、Webを後から公開。既存37件はfalse、NULLは0件 |
| 管理画面・地図・撮影・位置送信の追加変更 | GitHub `main` に反映 | Web/APIは本番公開。モバイルの署名・配布は未実施 |
| 担当コースIDの会社所属API検査 | GitHub `main` に反映 | APIは本番公開。DB側の保証と実DB結合テストは別工程 |
| 認証・会社境界の監査設計 | コミット済み | [監査と設計](mobile-auth-and-boundaries-2026-09.md)を参照 |

公開順はDB 183→GitHub `main` push→Vercel本番配信。`main` の `765f4ebc` はVercel deployment `dpl_CijPjPDFnXoX7NziT9A4srDFzDGv` としてREADYになり、`hakotora.jp` のエイリアスがこのデプロイを指すことを確認した。トップとログインは200、未認証の本人登録APIは401。iOS AASAとAndroid DALは署名情報の環境設定がないため503を返しており、ネイティブPasskeyの実機利用条件は未達。

GitHubのApp CIは型検査・全テスト・会社境界チェック・Webビルドを含めて成功。pages-build-deploymentも成功した。

## 次の認証作業

1. 担当コースのDB側同一会社保証を、PostgRESTの既存結合を壊さず検証する。
2. 通常・管理・復旧のセッション用途をサーバーで区別し、SMSだけのセッションから管理APIへ入れないようにする。
3. 既存アカウントのPasskey追加・復旧と振込先変更を、用途別の再確認・通知・監査で保護する。
4. モバイルのSecureStore保存・削除の完了待ちを実装し、署名済み実機でPasskey・復旧・旧アプリからの移行を検証する。

## 確認方法

Gitは `git fetch origin main` とコミット・ファイル照合、Vercelは `vercel ls nippo-ace --environment production` と `vercel inspect hakotora.jp`、EASは `build:list` を使用した。本番DBは `scripts/db/db.sh` で接続先refを照合し、183をBEGIN/ROLLBACKで試した後に1トランザクションで適用・台帳記録した。列のNOT NULL・既定値false・既存行と台帳を読み取りで確認した。コードは型検査、Web・モバイルテスト、会社境界静的検査、検証用環境値でのWebビルドを使用した。
