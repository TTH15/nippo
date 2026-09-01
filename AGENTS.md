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

## UIの共通ルール

- 利用者は軽配送業者。画面の文言は現場で使う短い言葉にし、「何をするか」「次に何をすればよいか」を伝える。細かなファイル容量・圧縮方式などの技術説明や、操作に不要な補足は出さない。必要な注意は影響と対処を簡潔に伝える（2026-09-01ユーザー指定）。
- 利用者向けの日付に `YYYY-MM-DD` のハイフン表記を出さない。年月日を省略しない場面は `YYYY/MM/DD（曜）`、短い通知等は `M月D日（曜）` など、文脈に合う日本語表記にする。DB・API・URL・ファイル名など内部値のISO日付は維持してよい（2026-09-01ユーザー指定）。
- 新規・改修するUIは `design.md` と `docs/hakotora-design-system.md` の「Web共通の操作ルール」を参照する。
- 開閉は `SmoothCollapse`、縦リストの並べ替えは `SortableList`、チェック項目は `CheckboxField` を再利用する。アニメーション値は `apps/web/src/lib/ui/motion.ts` に集約し、画面ごとの同等実装を増やさない。
- 既存画面も同じ操作を改修する際に移行する。見た目の共通化に業務上の順序・保存・認可の変更を混ぜない。

## 画像・PDFエクスポート

- 通常のPDFは数百KB程度（目安1MB未満）を狙う。jsPDFは `PDF_EXPORT_OPTIONS`、PNGを埋める場合は `pngToPdf`（ともに `apps/web/src/lib/pdfExport.ts`）を再利用し、まず画質を変えない圧縮を使う。大きい範囲を無理に低画質化しない。容量削減は出力処理側で行い、保存ボタンの容量表示や範囲縮小を促す案内は追加しない（2026-09-01ユーザー指定）。
- 新規・改修時は `docs/development/image-pdf-export.md` を参照する。シフト表の共通描画、シフトメモの補正済み画像をPDFへ使う方式、日別配車のDOM複製を用途で使い分ける。
- 文字下ずれは通常UIを動かす前に画像化時の計測・CSS干渉を確認する。既存の固定オフセットと新しい補正を無検証で重ねない。PNG本体とPDFの実ファイルで検証する。

## 標準のモック・プレビュー手順（2026-08-31 ユーザー指定）

- 新機能・UI改善・不具合修正など、今後の作業では**ログイン不要の管理ページのモック（プレビュー）を標準で用意・更新する**。追加の依頼や確認を待たず、対象機能に必要な画面と架空データを揃える。
- **実際の画面のUI・コードを再利用、または複製して土台にする。** ロゴ、全体ナビ、余白、文字サイズ、一覧の密度・表示期間、編集方法を既存画面に揃え、その上に今回の変更だけを載せる。独自デザインの別画面で代用しない。対象画面のソースと表示を先に確認し、再利用・複製元を記録する。
- プレビューは本番の認証・DB・API・通知送信から隔離する。実在の個人情報や秘密情報をコピーしない。本番認証を弱めてログイン不要にしてはならない。
- 見た目だけでなく、画面遷移・編集・保存・絞り込み・未設定・エラーなど変更箇所の操作を試せるようにする。既存の共通UIを再利用し、既存プレビューがあれば更新する。
- 起動方法をリポジトリに残し、**アプリ内ブラウザで実際に開いて操作・PC/スマホ幅を検証**する。操作だけでなく実画面との見た目・構造の一致も確認する。完了時はプレビューを開いた状態にし、URL・確認内容・モックの制限を伝える。
- 詳細は `docs/development/preview-workflow.md`。プレビューの作成・確認は本番適用や公開の許可を意味しない。

## サブエージェント

`.claude/agents/` に explorer / architect / reviewer / ui-auditor / security / tester。全て読み取り専用で、
ハコ虎固有の前提（RLS 不使用・本番DB直結・過去に踏んだ地雷）を常駐させてある。

Claude と Codex でこの6役を共用する。`.claude/agents/*.md` を役割定義の正本とし、Codex は
`.codex/skills/hakotora-subagents/SKILL.md` の手順で、必要な役の定義を全文読んでから委任する。
Claude固有の `tools` frontmatter は Codex の権限指定としては扱わない。役割の読み取り専用制約と
返却形式は引き継ぎ、実装やファイル変更は親エージェントが行う。
