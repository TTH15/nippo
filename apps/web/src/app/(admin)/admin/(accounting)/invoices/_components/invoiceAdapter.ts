import type { InvoiceDocData, InvoiceDocLine } from "./InvoiceDocument";

// GET /api/admin/invoices/[id] のレスポンス（payload は形が一定しないため防御的に読む）。
// 新仕様の追加項目（unit / period / loanRepay / extraOutsourcing）が無い旧 payload でも
// フォールバックして壊れないようにする。
type ApiInvoice = {
  invoiceNo?: string;
  clientName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
};

/** 文字列・数値・"¥1,234"・"▲500" などを安全に数値化（非数値は0）。 */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toLines(v: unknown): InvoiceDocLine[] {
  if (!Array.isArray(v)) return [];
  return v.map((r) => ({
    title: String(r?.title ?? ""),
    qty: num(r?.qty),
    unit: String(r?.unit ?? ""),
    price: num(r?.price),
  }));
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** API の請求書（payload 含む）を帳票表示データへ変換する。 */
export function toInvoiceDocData(invoice: ApiInvoice): InvoiceDocData {
  const p = invoice?.payload ?? {};
  const fromName = str(p.fromName);
  const fromParty = str(p?.parties?.fromParty);
  const showStamp = fromParty === "ace_creation" || /ACE\s*CREATION/i.test(fromName);
  const tax = p.taxSettings ?? {};

  return {
    toName: str(p.toName) || str(invoice.clientName),
    toAddrHtml: str(p.toAddr),
    toTel: p.toTel ? str(p.toTel) : undefined,
    toReg: p.toReg ? str(p.toReg) : undefined,
    honorific: str(p.honorific || p.toHonorific) || "御中",
    fromName,
    fromAddrHtml: str(p.fromAddr),
    fromTel: p.fromTel ? str(p.fromTel) : undefined,
    fromReg: p.fromReg ? str(p.fromReg) : undefined,
    showStamp,
    period: str(p.period || p.subject),
    invoiceNo: str(p.invoiceNo) || str(invoice.invoiceNo),
    taxEnabled: tax.enabled !== undefined ? Boolean(tax.enabled) : true,
    taxRatePercent: tax.rate !== undefined ? num(tax.rate) : 10,
    main: toLines(p?.tableData?.main),
    deduct: toLines(p?.tableData?.deduct),
    loanRepay: num(p.loanRepay),
    extraOutsourcing: num(p.extraOutsourcing),
    dueDate: str(p.dueDate),
    bankName: str(p.bankName),
    bankNo: str(p.bankNo),
    bankHolder: str(p.bankHolder),
    notes: str(p.notes),
  };
}
