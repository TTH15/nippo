# ハコ虎 Base（現場運営用アプリ）

iPad 推奨・スマホでも使う、**現場の事実を登録・確認する**ためのアプリ。ドライバー用の「ハコ虎」（`apps/mobile`）とは**別のアプリ**で、bundleId も別。

2026-09-18 時点では**入れ物だけ**で、業務機能は入っていない。何を載せるかと分担は [設計](../../docs/design/hakotora-base-2026-09.md) を参照。

## 分担の原則

> その場で起きた事実を記録・確認するのが Base、事実から金額や条件を決めるのが Web、自分の業務を進めるのが「ハコ虎」。

金銭処理（請求・報酬確定・控除・振込・単価や契約条件の変更・会社設定・権限管理）は Base に持ち込まない。到達できないことはアプリの画面ではなく**サーバー側の capability** で保証する。

## まだ動かせない

`apps/base` を workspace に取り込むには、リポジトリのルートで一度だけ **`npm install`** が要る（`package-lock.json` が書き換わる）。それまでは依存が入っていないので `npm start` も型チェックも通らない。

取り込んだ後に足すもの:

- ルート `package.json` の `typecheck` に `&& npm run typecheck -w @repo/base` を追加（追加しないと CI に載らない）
- `eas init`（このリポジトリはまだ未実施。`app.json` に `extra.eas.projectId` が無い）

## 決まっていないこと

`app.json` / `eas.json` の値は**内部配布を始めるまで変更してよい**。いまは次の既定値を置いてある。

| 項目 | 既定値 | 備考 |
|---|---|---|
| bundleId / package | `jp.hakotora.base` | 「ハコ虎」は `jp.hakotora.app`。別 ID なので同じ端末に両方入れられ、ログインも別々になる |
| 表示名 / slug | `ハコ虎 Base` / `hakotora-base` | |
| scheme | `hakotora-base` | |
| orientation | `default` | iPad の横向き・分割表示のため。「ハコ虎」は `portrait` 固定のまま |
| iOS deploymentTarget | 16.4 | `apps/mobile` と同じ |

このほか、共有 iPad の利用者切替、EAS プロジェクトの分け方、プレビューの作り方は設計書の「決めてほしいこと」に残っている。

## 構成

`apps/mobile` と同じ配管を写してある（これが無いと `@repo/core` を解決できない）。

- `metro.config.js` — workspace root の監視、node_modules の2段解決、`unstable_enablePackageExports`、NativeWind
- `babel.config.js` — `jsxImportSource: "nativewind"`
- `tsconfig.json` — `@repo/core/*` を `packages/core/src/**` へ直結
- `tailwind.config.js` / `global.css` — NativeWind（v4・Tailwind v3）
- `types/safe-area-classname.d.ts` — safe-area-context 5.x の `className` 型拡張

ネイティブプロジェクト（`ios/` `android/`）はコミットしない（CNG＝prebuild で生成）。
