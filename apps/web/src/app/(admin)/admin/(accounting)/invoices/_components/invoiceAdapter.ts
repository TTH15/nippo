import { getInvoiceIssuer } from "@/config/companies";
import type { InvoiceDocData, InvoiceDocLine } from "./InvoiceDocument";
import { resolveInvoiceKind, type InvoiceKind } from "./invoiceKinds";

// GET /api/admin/invoices/[id] のレスポンス（payload は形が一定しないため防御的に読む）。
// 新仕様の追加項目（unit / period / loanRepay / extraOutsourcing）が無い旧 payload でも
// フォールバックして壊れないようにする。自社（請求元）情報は config から補完。
type ApiInvoice = {
  invoiceNo?: string;
  clientName?: string;
  direction?: "outgoing" | "incoming";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
};

/** invoice_addresses の1件（請求先住所の補完用）。 */
export type CounterpartyAddress = {
  name?: string;
  postal_code?: string;
  address?: string;
  phone?: string;
  invoice_no?: string;
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

function addrHtml(postal?: string, address?: string): string {
  const p = str(postal);
  const a = str(address);
  if (!p && !a) return "";
  return p ? `〒${p}<br/>${a}` : a;
}

/**
 * API の請求書（payload 含む）を帳票表示データへ変換する。
 * counterparty を渡すと、payload に住所が無い請求先をアドレス帳の値で補完する。
 */
export function toInvoiceDocData(
  invoice: ApiInvoice,
  counterparty?: CounterpartyAddress,
): InvoiceDocData {
  const p = invoice?.payload ?? {};
  const issuer = getInvoiceIssuer();
  const kind: InvoiceKind = invoice.direction ?? resolveInvoiceKind(p?.parties);
  const isIncoming = kind === "incoming";
  const tax = p.taxSettings ?? {};

  // 請求先（to）：payload → 紐づく取引先アドレス →（受領なら自社）
  let toName = str(p.toName) || str(invoice.clientName) || str(counterparty?.name);
  let toAddrHtml = str(p.toAddr) || addrHtml(counterparty?.postal_code, counterparty?.address);
  let toTel = str(p.toTel) || str(counterparty?.phone);
  let toReg = str(p.toReg) || str(counterparty?.invoice_no);
  if (isIncoming) {
    toName = toName || issuer.name;
    toAddrHtml = toAddrHtml || issuer.addressHtml;
    toTel = toTel || issuer.tel;
    toReg = toReg || issuer.regNo;
  }

  // 請求元（from）：売上＝自社、受領＝ドライバー（payload）
  const fromName = str(p.fromName) || (isIncoming ? "" : issuer.name);
  const fromAddrHtml = str(p.fromAddr) || (isIncoming ? "" : issuer.addressHtml);
  const fromTel = str(p.fromTel) || (isIncoming ? "" : issuer.tel);
  const fromReg = str(p.fromReg) || (isIncoming ? "" : issuer.regNo);

  // 振込先：売上＝自社、受領＝ドライバー（payload）
  const bankName = str(p.bankName) || (isIncoming ? "" : issuer.bankName);
  const bankNo = str(p.bankNo) || (isIncoming ? "" : issuer.bankNo);
  const bankHolder = str(p.bankHolder) || (isIncoming ? "" : issuer.bankHolder);

  const showStamp =
    !isIncoming &&
    Boolean(issuer.stampPath) &&
    (str(p?.parties?.fromParty) === "ace_creation" || /ACE\s*CREATION/i.test(fromName));

  return {
    kind,
    toName,
    toAddrHtml,
    toTel: toTel || undefined,
    toReg: toReg || undefined,
    honorific: str(p.honorific || p.toHonorific) || "御中",
    fromName,
    fromAddrHtml,
    fromTel: fromTel || undefined,
    fromReg: fromReg || undefined,
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
    bankName,
    bankNo,
    bankHolder,
    notes: str(p.notes),
  };
}
