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

## 作業ログは月別（2026-08-18 分割）

- 本文は `docs/worklog/YYYY-MM.md` の末尾に追記する。**あわせて索引 `docs/worklog.md` の
  「直近のエントリ」にも1行足す**（Stop フックが索引の mtime を見ているため）
- 読むときは全文を読まない。`grep -n '^## ' docs/worklog/YYYY-MM.md` で見出しと行番号を
  一覧してから、必要な節だけ `offset` / `limit` で読む

## サブエージェント

`.claude/agents/` に explorer / architect / reviewer / ui-auditor / security / tester。全て読み取り専用で、
ハコ虎固有の前提（RLS 不使用・本番DB直結・過去に踏んだ地雷）を常駐させてある。

Claude と Codex でこの6役を共用する。`.claude/agents/*.md` を役割定義の正本とし、Codex は
`.codex/skills/hakotora-subagents/SKILL.md` の手順で、必要な役の定義を全文読んでから委任する。
Claude固有の `tools` frontmatter は Codex の権限指定としては扱わない。役割の読み取り専用制約と
返却形式は引き継ぎ、実装やファイル変更は親エージェントが行う。
