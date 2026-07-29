# hakotora (nippo-monorepo)

npm workspaces のモノレポ。`apps/web`(Next 16 / React 19、Vercel 本番)+ `apps/mobile`(Expo 57 / React Native 0.86)+ `packages/core`(`@repo/core`)。

## 共有パッケージ @platform/* の規約(ADR-0002)

- `packages/auth` `packages/api-client` は `~/Developer/packages/` からの vendor コピー。**直接編集禁止** — 原本を編集し `~/Developer/scripts/sync-packages.sh projects/hakotora <pkg>` で再配布する(各ディレクトリの `VENDORED.md` 参照)。
- `@repo/core` の `auth/` `api/` は @platform をアプリ固有のキー・型と束ねるシム。localStorage キー `nippo_token` / `nippo_driver` は**変更禁止**(変更 = 全ユーザーがログアウト)。

## React は 19.2 に一本化済み（2026-07 SDK 57 移行）

web / mobile とも React 19.2.3（root の `overrides` で単一コピーに固定）。かつての 18/19 混在対策
（web tsconfig の paths 固定・vitest の react alias）は撤去済み。**root の package.json に
react / react-native / expo を直接依存で足さないこと**（混在の再発源になる。経緯は
`~/Developer/docs/patterns/mixed-react-monorepo.md`）。

- vitest に react 系ライブラリを追加して「Objects are not valid as a React child」等で落ちたら、`apps/web/vitest.config.mts` の `deps.optimizer.client.include` に追加する
- mobile の NativeWind は v4.2（Tailwind v3）。v5(Tailwind v4) は stable 化してから移行する
