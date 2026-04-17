# デザインガイドライン（nippo-mvp）

管理画面・フォーム・一覧の見た目を揃えるための参照用ドキュメントです。新規画面やコンポーネントを追加するときは、ここに沿うと一貫性が保ちやすくなります。

## カラーと階層

- **ベース**: Tailwind の `slate` を軸にする（背景 `bg-slate-50` / `bg-white`、区切り `border-slate-200`、本文 `text-slate-700`、補足 `text-slate-500`）。
- **インタラクション**: フォーカスは `focus:ring-1 focus:ring-slate-400`、ホバーは控えめに `hover:bg-slate-50` や `hover:bg-slate-200`。
- **意味づけ（期限・状態）**: 一覧のバッジや強調は、緑・黄・赤・グレーなど用途に応じて使い分け、同じ意味には同じ色を再利用する。

## タイポグラフィ

- **見出し（セクション）**: `text-sm font-semibold text-slate-700`。
- **説明文**: `text-xs text-slate-500`。
- **ラベル**: `text-xs font-medium text-slate-600`（フォーム内）。
- **本文・入力**: `text-sm` を基本とする。

## レイアウト

- **セクション区切り**: `pt-4 mt-4 border-t border-slate-200` でブロックを分ける。
- **カード型一覧**: `rounded-lg border border-slate-200 bg-white shadow-sm` など、既存の管理画面カードに合わせる。
- **余白**: フォーム内の縦方向は `space-y-3` を標準とする。

## フォーム入力

- **テキスト入力**: `px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400`。
- **日付**: ネイティブの `type="date"` ではなく、共通コンポーネント `@/lib/components/DatePicker` を使う。値は `Date | undefined`、表示は `yyyy年MM月dd日`（コンポーネント内で `date-fns` + `ja` ロケール）。
- **フォーム状態の保存**: API や DB が `YYYY-MM-DD` 文字列の場合は、`Date` と相互変換する際はタイムゾーンずれを避けるため、必要に応じて `T12:00:00` を付与してパースする。

## アイコンとボタン

- Font Awesome / Lucide は既存画面に合わせて選択する。
- 破壊的操作（削除など）は既存の `ConfirmDialog` パターンに合わせる。

## 変更時の注意

- 新しい色や角丸のバリエーションを増やす前に、既存の slate + 上記パターンで足りないか検討する。
- このファイルは「方針」のメモであり、細部は実装コードの既存パターンを優先してよい。
