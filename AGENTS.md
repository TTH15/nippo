# hakotora (nippo-monorepo)

npm workspaces のモノレポ。`apps/web`(Next 16 / React 19、Vercel 本番)+ `apps/mobile`(Expo 52 / React 18)+ `packages/core`(`@repo/core`)。

## 共有パッケージ @platform/* の規約(ADR-0002)

- `packages/auth` `packages/api-client` は `~/Developer/packages/` からの vendor コピー。**直接編集禁止** — 原本を編集し `~/Developer/scripts/sync-packages.sh projects/hakotora <pkg>` で再配布する(各ディレクトリの `VENDORED.md` 参照)。
- `@repo/core` の `auth/` `api/` は @platform をアプリ固有のキー・型と束ねるシム。localStorage キー `nippo_token` / `nippo_driver` は**変更禁止**(変更 = 全ユーザーがログアウト)。

## React 18/19 混在の注意

web は React 19、mobile は Expo 52 のため React 18。ルートに 18 系が hoist されるため:

- web の型解決は `apps/web/tsconfig.json` の `paths` で 19 系に固定済み
- vitest で react 系ライブラリを追加して「Objects are not valid as a React child」等で落ちたら、`apps/web/vitest.config.mts` の `deps.optimizer.client.include` に追加する

詳細: `~/Developer/docs/patterns/mixed-react-monorepo.md`
