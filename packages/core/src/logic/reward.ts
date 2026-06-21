// 報酬・請求書まわりのドメインロジック（純粋・プラットフォーム非依存）。
// 金額計算は支払いに直結するため、ここに集約してテストで固定する。
import type {
  RewardLogDetail,
  RewardsSummary,
  MyInvoice,
  InvoiceRow,
  InvoiceAttachment,
} from "../types";
import { formatMonthDayJP } from "./calendar";

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
