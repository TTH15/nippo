# 請求書 React 移行 進捗ドキュメント

最終更新: 2026-06-27

## 1. 背景と目的

請求書帳票はもともと `apps/web/public/invoice/{index.html,script.js,styles.css}` の
Vanilla.js 実装を **iframe で埋め込む**構成だった。これを Next.js/React へ移行し、
あわせて新デザイン（税抜単価モデル・お支払い分の分離・サマリー表・配色）と、
**売上請求書（自社→他社）/ 受領請求書（ドライバー→自社・自社が代理作成）の分離**を行う。

- 計算ロジックは支払いに直結するため `@repo/core`（プラットフォーム非依存）に集約しテストで固定。
- 表示は React コンポーネント化し、データは既存 API（`/api/admin/invoices/*`）から取得。
- DB マイグレーションは原則不要（新項目は `invoice_documents.payload`(jsonb) に格納し、
  `amount` を差引き請求額と同期）。

## 2. アーキテクチャ

- ロジック/型：`packages/core/src/logic/reward.ts` / `types/reward.ts`
  - `computeInvoiceTotals`（税抜単価モデル・行ごと四捨五入・外税）
  - 差引き請求額 = 請求 − お支払い − 借入返済 + 追加外注
- 表示：`apps/web/src/app/(admin)/admin/(accounting)/invoices/_components/`
  - `InvoiceDocument.tsx` … A4帳票（読み取り表示・PDF対象）
  - `invoiceKinds.ts` … 種別ごとの設定（タイトル/見出し/サマリー項目/配色）
  - `invoiceAdapter.ts` … API payload → 表示props（旧payload後方互換・住所補完）
  - `editorModel.ts` … エディタ状態と変換（純粋・テスト済）
  - `InvoiceEditor.tsx` … 入力フォーム＋ライブプレビュー＋保存
- 自社（請求元）固定情報：`apps/web/src/config/companies.ts` の `InvoiceIssuer`
  （`getInvoiceIssuer()`。未設定時は ACE フォールバック）

## 3. データモデル（既存）

- `invoice_documents`：一覧/管理列（`amount` `status` `invoice_no` `month_yyyy_mm`
  `section` `counterparty_invoice_address_id` `driver_id`）＋ `payload`(jsonb)
- `payload`（表示内容）：`toName/toAddr/fromName/fromAddr/...`、
  `tableData.main/deduct`（`{title,qty,unit,price}`）、`taxSettings`、`parties`、
  新項目 `period` `loanRepay` `extraOutsourcing`
- `invoice_addresses`：取引先アドレス帳（`name/postal_code/address/phone/invoice_no`）
- 種別判定：`direction`（無ければ `parties` から推定。請求先=自社かつ請求元=ドライバー→受領）

## 4. 進捗

| 範囲 | 状態 | PR |
|---|---|---|
| プレビュー（読み取り）React化 | ✅ main マージ済 | #26 |
| 売上/受領の種別分割（設定駆動） | ✅ main マージ済 | #28 |
| 作成/編集エディタ React化（ライブプレビュー・保存） | ✅ レビュー中 | #29 |
| 請求先＝取引先アドレス帳連携／自社情報 config 集約／対象期間 | ✅ #29 に追加 | #29 |
| 受領（ドライバー連携）の作成 | ✅ #29 に追加（ドライバーセレクタ） | #29 |
| PDF ダウンロードの React 移植（複数ページ） | ✅ main マージ済 | #30 |
| WYSIWYG 化（編集＝プレビュー・帳票に直接インライン編集） | 🚧 着手 | – |
| 印刷（ブラウザ印刷CSS） | ⬜ 未着手（当面はPDFで代替） | – |
| 添付・取引先CRUDのReact統合 | ⬜ 未着手 | – |

## 5. 既知の制約・TODO

- **保存の実APIラウンドトリップは要実機確認**（認証＋Supabase が必要）。
- 受領（incoming）の新規作成は **ドライバー選択 UI** を実装中（POST ルートは
  `payload.parties.fromParty = drv-<uuid>` から `driver_id` を導出）。
- PDF/印刷は未移行。プレビュー画面の「旧プレビュー」リンク、作成画面の「従来エディタ」
  リンクで旧 iframe を残置（パリティ到達後に撤去）。
- ローカル `.env.local` は `NEXT_PUBLIC_COMPANY_CODE=DEFAULT`。請求元情報は ACE
  フォールバックで表示（本番 ACE では会社設定どおり）。

## 6. 検証

- `cd apps/web && npx tsc --noEmit` → エラー0
- `cd apps/web && npx vitest run reward InvoiceDocument editorModel` → 34件合格
- 目視：`/admin/invoices/[id]/preview`（読み取り）・`/admin/invoices/new`・`/admin/invoices/[id]/edit`
