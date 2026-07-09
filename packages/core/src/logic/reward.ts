// 報酬・請求書まわりのドメインロジック（純粋・プラットフォーム非依存）。
// 金額計算は支払いに直結するため、ここに集約してテストで固定する。
import type {
  RewardLogDetail,
  RewardsSummary,
  MyInvoice,
  InvoiceRow,
  InvoiceAttachment,
  InvoiceTotalsInput,
  InvoiceTotals,
  TaxBasis,
} from "../types";
import { formatMonthDayJP } from "./calendar";
import { exclusiveOf, inclusiveOf } from "./taxBasis";

/** 金額を符号付き「N円」表記にする（負値は -N円、3桁区切り）。 */
export function formatYen(amount: number): string {
  return amount >= 0
    ? `${amount.toLocaleString("ja-JP")}円`
    : `-${Math.abs(amount).toLocaleString("ja-JP")}円`;
}

/** ログの表示ラベル（content > type_name > "—" の優先順）。 */
export function logLabel(log: RewardLogDetail): string {
  return log.content || log.type_name || "—";
}

/** 報酬ログ1行を「M月D日 ラベル N円」に整形。 */
export function formatLogLine(log: RewardLogDetail): string {
  return `${formatMonthDayJP(log.log_date)} ${logLabel(log)} ${formatYen(log.amount)}`;
}

/** 日報ベースの日別報酬と手動ログを日付順にまとめた一覧。 */
export function mergedDetails(rewards: RewardsSummary): RewardLogDetail[] {
  const daily = rewards.dailyIncomeDetails ?? [];
  const manual = rewards.logDetails ?? [];
  return [...daily, ...manual].sort((a, b) =>
    a.log_date.localeCompare(b.log_date),
  );
}

/** uploaded_document 由来の請求書か。 */
export function isUploadedDocument(inv: MyInvoice): boolean {
  return String(inv?.payload?.source || "") === "uploaded_document";
}

/** 承認待ち（pending_approval）の請求書のみ抽出。 */
export function pendingInvoices(invoices: MyInvoice[]): MyInvoice[] {
  return invoices.filter((inv) => inv.status === "pending_approval");
}

/** 明細行を表示用に数値化する（数量・単価・金額）。非数値・欠損は0扱い。 */
export function parseRow(row: InvoiceRow): {
  qty: number;
  price: number;
  amount: number;
} {
  const qty = Number(row?.qty) || 0;
  const price = Number(row?.price) || 0;
  return { qty, price, amount: qty * price };
}

/** 明細行1行の金額（数量×単価、数値化できない値は0扱い）。 */
export function rowAmount(row: InvoiceRow): number {
  return parseRow(row).amount;
}

/** 明細行の合計金額。 */
export function sumRows(rows: InvoiceRow[]): number {
  return rows.reduce((acc, row) => acc + rowAmount(row), 0);
}

/**
 * 請求書 payload から明細・添付を防御的に取り出す。
 * payload は形が一定しない（any）ため、配列でなければ空配列に正規化してここで吸収する。
 */
export function invoiceLines(inv: MyInvoice): {
  main: InvoiceRow[];
  deduct: InvoiceRow[];
  attachments: InvoiceAttachment[];
} {
  const payload = inv?.payload ?? {};
  return {
    main: Array.isArray(payload?.tableData?.main) ? payload.tableData.main : [],
    deduct: Array.isArray(payload?.tableData?.deduct) ? payload.tableData.deduct : [],
    attachments: Array.isArray(payload?.attachments) ? payload.attachments : [],
  };
}

/**
 * 行の入力値(price, priceBasis基準)を、指定した基準(displayBasis)での単価に換算する。
 * priceBasis未設定の行は "exclusive"（従来どおり税抜）として扱う。
 * 基準が一致していればそのまま、異なれば taxBasis のヘルパーで換算する。
 */
export function resolveRowPrice(row: InvoiceRow, displayBasis: TaxBasis = "exclusive"): number {
  const price = Number(row?.price) || 0;
  const basis: TaxBasis = row?.priceBasis === "inclusive" ? "inclusive" : "exclusive";
  return displayBasis === "exclusive" ? exclusiveOf(price, basis) : inclusiveOf(price, basis);
}

/** 明細行1行の合計（displayBasis側の単価×数量、円未満は四捨五入）。 */
export function roundedRowAmount(row: InvoiceRow, displayBasis: TaxBasis = "exclusive"): number {
  const qty = Number(row?.qty) || 0;
  return Math.round(qty * resolveRowPrice(row, displayBasis));
}

/** 明細行の小計（各行を四捨五入してから合算＝表示と一致）。 */
export function sumRowsRounded(rows: InvoiceRow[], displayBasis: TaxBasis = "exclusive"): number {
  return rows.reduce((acc, row) => acc + roundedRowAmount(row, displayBasis), 0);
}

/**
 * 請求書の合計を計算する（税抜/税込どちらの基準で表示するかを選べるモデル）。
 * - 各行 合計 = round(qty × displayBasis側の単価)、小計はその合算
 * - displayBasis="exclusive": 行の合算は税抜小計。消費税は外税で加算する（円未満切り捨て）。
 * - displayBasis="inclusive": 行の合算は税込合計そのもの。税抜小計・消費税額は内税として
 *   逆算する（billGross/deductGrossを二重課税しないよう、税を「足す」のではなく「按分で戻す」）。
 * - 差引き請求額 = 請求 − お支払い − 借入返済 + 追加外注支払い（すべてdisplayBasis側の値）
 * 支払いに直結するためここに集約し、テストで固定する。
 */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const rate = input.taxEnabled ? (Number(input.taxRatePercent) || 0) / 100 : 0;
  const displayBasis: TaxBasis = input.displayBasis === "inclusive" ? "inclusive" : "exclusive";

  const rowsTotal = (rows: InvoiceRow[]): { subtotal: number; tax: number; gross: number } => {
    const sum = sumRowsRounded(rows, displayBasis);
    if (displayBasis === "exclusive") {
      const tax = Math.floor(sum * rate);
      return { subtotal: sum, tax, gross: sum + tax };
    }
    // inclusive: sum は既に税込。税抜相当額を内税で逆算する（rate=0ならそのまま）。
    const subtotal = Math.floor(sum / (1 + rate));
    return { subtotal, tax: sum - subtotal, gross: sum };
  };

  const bill = rowsTotal(input.main);
  const deduct = rowsTotal(input.deduct);
  const billSubtotal = bill.subtotal;
  const deductSubtotal = deduct.subtotal;
  const billTax = bill.tax;
  const deductTax = deduct.tax;
  const billGross = bill.gross;
  const deductGross = deduct.gross;

  const loanRepay = Number(input.loanRepay) || 0;
  const extraOutsourcing = Number(input.extraOutsourcing) || 0;

  const total = billGross - deductGross - loanRepay + extraOutsourcing;
  const netTax = billTax - deductTax;

  return {
    billSubtotal,
    deductSubtotal,
    billTax,
    deductTax,
    netTax,
    billGross,
    deductGross,
    total,
  };
}
