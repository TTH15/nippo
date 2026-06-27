# 請求書 React 移行ドキュメント

最終更新: 2026-06-27

## 1. 概要

請求書帳票はもともと `apps/web/public/invoice/` の Vanilla.js を **iframe 埋め込み**していたが、
**Next.js/React に全面移行**した（iframe は撤去済み）。あわせて新デザイン（税抜単価モデル・
お支払い分の分離・サマリー表・配色）と、**売上請求書 / 受領請求書の種別分離**を実装。

- 編集とプレビューは**同一の WYSIWYG**（帳票に直接インライン編集。Word 風）。
- 計算は `@repo/core`（プラットフォーム非依存）に集約しテストで固定。
- データは既存 API（`/api/admin/invoices/*`）。新項目は `invoice_documents.payload`(jsonb)
  に格納し、`amount` を差引き請求額と同期（DB マイグレーション不要）。

## 2. 現在のファイル構成（重要）

- ロジック/型（`packages/core/src/`）
  - `logic/reward.ts`：`computeInvoiceTotals`（税抜単価・行ごと四捨五入・外税）、
    `roundedRowAmount` / `sumRowsRounded`。差引き = 請求 − お支払い − 借入返済 + 追加外注。
  - `types/reward.ts`：`InvoiceRow`（unit 付き）、`InvoiceTotalsInput` / `InvoiceTotals`。
- 表示/編集（`apps/web/src/app/(admin)/admin/(accounting)/invoices/_components/`）
  - **`InvoiceSheet.tsx`** … 単一の A4 帳票。`readOnly` で閲覧/PDF、編集時は帳票上で直接
    インライン編集。**入力欄を持つ子（T / LineTable）は必ずモジュールレベル定義**
    （関数内定義は毎レンダー再マウント→フォーカス喪失・IME不可になる）。
  - **`InvoiceSheetEditor.tsx`** … 上部スリムツールバー（種別/消費税/取引先・ドライバー
    選択/保存/PDF/印刷）＋ `InvoiceSheet`（編集）。左フォームは持たない。
  - `invoiceKinds.ts` … 種別設定（タイトル・見出し・サマリー項目・**配色テーマ**）。
    `outgoing`=売上(濃紺/青/緑)、`incoming`=受領(ティール/アンバー)。`resolveInvoiceKind`。
  - `editorModel.ts` … `EditorState` と変換（`blankEditorState`/`editorFromInvoice`/
    `docDataFromEditor`/`payloadFromEditor`/`amountFromEditor`/`saveBodyFromEditor`/
    `applyCounterparty`/`defaultTargetPeriod`）。`InvoiceDocData`/`CounterpartyAddress` 型もここ。
  - テスト：`editorModel.test.ts` / `InvoiceSheet.test.tsx`。
- ページ
  - `invoices/[id]/preview/page.tsx` … `InvoiceSheet readOnly` ＋ 印刷/PDF/編集。
  - `invoices/new/page.tsx` … `InvoiceSheetEditor mode=new`（`?month&section` で draft 取込、
    `?invoiceId` は `[id]/edit` へ転送）。
  - `invoices/[id]/edit/page.tsx` … `InvoiceSheetEditor mode=edit`。
- PDF：`apps/web/src/lib/invoicePdf.ts`（html2canvas+jsPDF、複数ページ分割）。
- 印刷：`apps/web/src/app/globals.css` の `@media print`（`.invoice-print-root` のみ印刷）。
- 自社（請求元）固定情報：`apps/web/src/config/companies.ts` の `InvoiceIssuer`
  （`getInvoiceIssuer()`。未設定＝DEFAULT 時は ACE フォールバック）。
- 印鑑画像：`apps/web/public/invoice/ACE_CREATION_stamp_1.png`（iframe 撤去後も保持）。

## 3. データモデル

- `invoice_documents`：一覧/管理列（`amount` `status` `invoice_no` `month_yyyy_mm`
  `section` `counterparty_invoice_address_id` `driver_id`）＋ `payload`(jsonb)。
- `payload`：`toName/toAddr/fromName/fromAddr/...`、`tableData.main/deduct`
  （`{title,qty,unit,price}`）、`taxSettings`、`parties`、`period`/`loanRepay`/`extraOutsourcing`。
- `invoice_addresses`：取引先アドレス帳。種別判定は `direction`（無ければ `parties` から推定）。

## 4. 進捗（すべて main マージ済み）

| 範囲 | PR |
|---|---|
| プレビュー React 化 | #26 |
| 売上/受領 種別分割（設定駆動） | #28 |
| 作成/編集エディタ＋取引先/自社/対象期間/受領ドライバー連携 | #29 |
| PDF ダウンロード（複数ページ） | #30 |
| WYSIWYG（編集＝プレビュー・インライン編集／入力フォーカス修正含む） | #31 |
| 印刷（請求書シートのみ A4） | #32 |
| 編集が空になる不具合修正＋旧 iframe 撤去 | #33 |

## 5. デザイン修正の入口（次の作業向け）

- **色**：`invoiceKinds.ts` の `COOL`(売上) / `WARM`(受領) テーマ、または各 PR で使った
  ブランド値。`InvoiceSheet.tsx` 内のスタイルは `style={{... theme色 ...}}` で参照。
- **レイアウト/文字サイズ/余白/罫線**：`InvoiceSheet.tsx`（A4 シート本体。`w-[210mm]`、
  `padding 14mm`、各 `text-[..px]`・`border` 指定）。
- **タイトル/見出し/サマリー項目/単位ラベル**：`invoiceKinds.ts`（docTitle・billSectionTitle・
  summaryRows・finalLabel 等）。
- **自社情報・振込先・印鑑**：`config/companies.ts`。

## 6. 既知の制約・今後（任意）

- 保存/PDF の実 API ラウンドトリップは認証環境での実機確認推奨。
- **将来（急がない）**: セル編集を表計算（Excel/スプレッドシート）風 UX に寄せる
  （セル間キーボード移動・Tab/Enter・コピペ等）。現状は per-cell `<input>`。
- 添付ファイル対応、取引先アドレス帳 CRUD の React 統合は未着手。

## 7. 検証

- `cd apps/web && npx tsc --noEmit` → エラー0
- `cd apps/web && npx vitest run reward editorModel InvoiceSheet` → 全件合格
- 画面：`/admin/invoices`（一覧）→ 作成 `/new`、編集 `/[id]/edit`、プレビュー `/[id]/preview`
