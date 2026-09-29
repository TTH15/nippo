# 既存変更の公開状態と今回の作業境界（2026/09/29）

## 確認した基点

- 元の作業ツリー: `/Users/H.Takaya/Developer/projects/hakotora`。`main` は `1259eb64` で、`origin/main` より4コミット前。多数の未コミット差分と未追跡ファイルがある。このツリーの変更を一括commit/pushしない。
- GitHub `origin/main`: `b7dc455a4512d614f11d35ddfc7058dc5faa4fac`。2026/09/29にfetchして確認。
- 本番Web: Vercel `nippo-ace` の `hakotora.jp` エイリアスは READY の deployment `dpl_2rRcDJwVHsXwF7RSKNrLPL5qJtAC`、Git SHA `b7dc455` を指す。開発用の `hakotora-dev` とは別プロジェクト。
- 今回の作業ツリー: `/Users/H.Takaya/.codex/worktrees/mobile-auth-boundaries/hakotora`、ブランチ `codex/mobile-auth-boundaries`。`origin/main` の `b7dc455` から作成。元ツリーの未コミット実装は持ち込まない。

## 以前の変更の状態

| 項目 | コミット | 本番・配布の確認 | 今回の扱い |
| --- | --- | --- | --- |
| 共有シフトメモ | `454f197` が `origin/main` に存在 | 作業ログにDB migration 184適用の記録。Webは後続の `b7dc455` を配信中。DBの現在値はこのセッションで直接確認できていない。 | 認証・会社境界の変更へ混ぜない。 |
| 会社別撮影設定・駐車APIと旧アプリ向け任意化 | `612bac1` / `7ef6027` / `b7dc455` が `origin/main` に存在 | 作業ログにDB migration 185適用の記録。Vercelで `b7dc455` の本番配信を直接確認。 | Web/APIの公開済み基点として扱う。モバイルUIの未公開差分は別作業。 |
| ネイティブPasskey・EAS/OTA設定・新モバイルUI | 元ツリーの未コミット差分。`apps/mobile/src/auth/passkey.ts` は `origin/main` に存在しない。 | EAS `@next-eight/hakotora` の `build:list --platform all` は空配列。署名・配布・実機認証を確認できない。EAS projectの紐付けとpreview環境設定は以前の作業ログに記録。 | 既存の配布準備作業として元ツリーに保持。認証境界の実装時、必要な小さい差分だけレビューして移植する。 |
| 新規招待のPasskey原則必須化 | migration 183とWeb変更が元ツリーに未コミット。183は `origin/main` に存在しない。 | 作業ログではDB適用・Web公開とも未実施。現在のDB状態は直接確認していない。 | 初回登録と既存利用者の復旧を分ける設計へ合うよう、別の公開単位としてレビューする。 |
| 認証・会社境界の監査文書 | 前セッションで作成した未コミット文書を、この専用ブランチへ複製した。 | 実装・本番変更ではない。 | [監査と設計](mobile-auth-and-boundaries-2026-09.md)を今回の判断基点にする。 |

元ツリーには上記以外にもホーム3D、撮影、シフト、管理画面等の差分がある。`origin/main` と元ツリーのファイル内容が重なるものもあるため、ファイル単位の一括コピーや `main` の強制更新をしない。

## このブランチで進める範囲

1. 担当コースIDなどの会社境界をサーバーで検査し、他社IDで書き込みが起きないテストを追加する。
2. 通常・管理・復旧のセッション用途をサーバーで区別し、SMSだけのセッションから管理APIへ入れないようにする。BaseとWebの管理導線を同じ条件で扱う。
3. 既存アカウントのPasskey追加と復旧、振込先の登録・変更を、用途別の再確認・通知・例外手順で保護する。
4. モバイルのSecureStore保存・削除の完了待ちと、必要な認証UIを選別して移植・検証する。

各段階を独立した差分としてレビューする。モバイルの撮影・地図・シフト・背景測位、migration 183の本番適用、EAS署名ビルド、OTA公開、Web本番公開はこのブランチの変更と一括にしない。必要な依存があれば、対象差分と公開順を先に明示する。

第一段階のAPI検査はこのブランチ内の別コミットとして進める。コースID全件の自社所属を作成・編集の更新前に確認する。DBのトリガー等は、migration 180で発生したPostgREST結合障害を再現できる環境で検証してから独立した変更とする。

## 証拠と限界

- Git: `git fetch origin main`、`git log HEAD..origin/main`、`git cat-file -e origin/main:<path>`。
- Vercel: `vercel ls nippo-ace --environment production --limit 5 --format json` と `vercel inspect hakotora.jp --format=json`。エイリアスのdeployment・Git SHA・READYを確認した。
- EAS: 元ツリーの `apps/mobile` で `npx eas-cli@24.7.0 build:list --platform all --limit 5 --non-interactive --json` が `[]`。
- Supabase CLIの `migration list --linked` は、この作業環境にproject refのリンクがなく実行できなかった。184/185の適用は元ツリーの未コミット `docs/worklog/2026-09.md` にある記録であり、この監査の直接DB検証ではない。このブランチの同名ファイルにはその記録を持ち込んでいない。
