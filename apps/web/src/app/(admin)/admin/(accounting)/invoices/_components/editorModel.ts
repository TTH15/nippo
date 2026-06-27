import { computeInvoiceTotals } from "@repo/core/logic/reward";
import type { InvoiceDocData, InvoiceDocLine } from "./InvoiceDocument";
import { resolveInvoiceKind, type InvoiceKind } from "./invoiceKinds";

// 請求書エディタの編集状態（純粋データ）と、表示/保存への変換。
// 入力欄は自由入力のため数値は string で保持し、変換時に数値化する。

export type EditorLine = {
  title: string;
  qty: string;
  unit: string;
  price: string;
};

export type EditorState = {
  id?: string;
  kind: InvoiceKind;
  // 宛先
  toName: string;
  toAddrHtml: string;
  toTel: string;
  toReg: string;
  honorific: string;
  // 差出
  fromName: string;
  fromAddrHtml: string;
  fromTel: string;
  fromReg: string;
  showStamp: boolean;
  // メタ
  period: string;
  invoiceNo: string;
  // 金額
  taxEnabled: boolean;
  taxRatePercent: string;
  main: EditorLine[];
  deduct: EditorLine[];
  loanRepay: string;
  extraOutsourcing: string;
  // 振込先
  dueDate: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
  notes: string;
  // 管理（保存時のトップレベル列・payload保持）
  section: string;
  counterpartyInvoiceAddressId: string | null;
  status: "draft" | "pending_approval" | "approved" | "paid";
  parties: { fromParty: string; toParty: string };
};

const n = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown): string => (v == null ? "" : String(v));

export function emptyLine(): EditorLine {
  return { title: "", qty: "", unit: "", price: "" };
}

/** 種別ごとの空エディタ状態。 */
export function blankEditorState(kind: InvoiceKind): EditorState {
  const isIncoming = kind === "incoming";
  return {
    kind,
    toName: isIncoming ? "株式会社ACE CREATION" : "",
    toAddrHtml: "",
    toTel: "",
    toReg: "",
    honorific: "御中",
    fromName: isIncoming ? "" : "株式会社ACE CREATION",
    fromAddrHtml: "",
    fromTel: "",
    fromReg: "",
    showStamp: !isIncoming,
    period: "",
    invoiceNo: "",
    taxEnabled: true,
    taxRatePercent: "10",
    main: [emptyLine()],
    deduct: [emptyLine()],
    loanRepay: "0",
    extraOutsourcing: "0",
    dueDate: "",
    bankName: "",
    bankNo: "",
    bankHolder: "",
    notes: "",
    section: "Amazon",
    counterpartyInvoiceAddressId: null,
    status: "draft",
    parties: isIncoming
      ? { fromParty: "", toParty: "ace_creation" }
      : { fromParty: "ace_creation", toParty: "" },
  };
}

type ApiInvoice = {
  id?: string;
  invoiceNo?: string;
  clientName?: string;
  section?: string;
  status?: EditorState["status"];
  counterpartyInvoiceAddressId?: string | null;
  direction?: InvoiceKind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
};

function linesFromPayload(v: unknown): EditorLine[] {
  if (!Array.isArray(v) || v.length === 0) return [emptyLine()];
  return v.map((r) => ({
    title: s(r?.title),
    qty: r?.qty == null ? "" : String(r.qty),
    unit: s(r?.unit),
    price: r?.price == null ? "" : String(r.price),
  }));
}

/** 既存請求書（API）→ エディタ状態。 */
export function editorFromInvoice(inv: ApiInvoice): EditorState {
  const p = inv?.payload ?? {};
  const kind: InvoiceKind = inv.direction ?? resolveInvoiceKind(p?.parties);
  const base = blankEditorState(kind);
  const tax = p.taxSettings ?? {};
  const fromName = s(p.fromName) || base.fromName;
  return {
    ...base,
    id: inv.id,
    toName: s(p.toName) || s(inv.clientName) || base.toName,
    toAddrHtml: s(p.toAddr),
    toTel: s(p.toTel),
    toReg: s(p.toReg),
    honorific: s(p.honorific || p.toHonorific) || "御中",
    fromName,
    fromAddrHtml: s(p.fromAddr),
    fromTel: s(p.fromTel),
    fromReg: s(p.fromReg),
    showStamp:
      s(p?.parties?.fromParty) === "ace_creation" || /ACE\s*CREATION/i.test(fromName),
    period: s(p.period || p.subject),
    invoiceNo: s(p.invoiceNo) || s(inv.invoiceNo),
    taxEnabled: tax.enabled !== undefined ? Boolean(tax.enabled) : true,
    taxRatePercent: tax.rate !== undefined ? String(tax.rate) : "10",
    main: linesFromPayload(p?.tableData?.main),
    deduct: linesFromPayload(p?.tableData?.deduct),
    loanRepay: p.loanRepay != null ? String(p.loanRepay) : "0",
    extraOutsourcing: p.extraOutsourcing != null ? String(p.extraOutsourcing) : "0",
    dueDate: s(p.dueDate),
    bankName: s(p.bankName),
    bankNo: s(p.bankNo),
    bankHolder: s(p.bankHolder),
    notes: s(p.notes),
    section: s(inv.section) || base.section,
    counterpartyInvoiceAddressId: inv.counterpartyInvoiceAddressId ?? null,
    status: inv.status ?? "draft",
    parties: {
      fromParty: s(p?.parties?.fromParty) || base.parties.fromParty,
      toParty: s(p?.parties?.toParty) || base.parties.toParty,
    },
  };
}

function toDocLines(lines: EditorLine[]): InvoiceDocLine[] {
  return lines.map((l) => ({
    title: l.title,
    qty: n(l.qty),
    unit: l.unit,
    price: n(l.price),
  }));
}

/** エディタ状態 → 帳票表示データ（ライブプレビュー用）。 */
export function docDataFromEditor(st: EditorState): InvoiceDocData {
  return {
    kind: st.kind,
    toName: st.toName,
    toAddrHtml: st.toAddrHtml,
    toTel: st.toTel || undefined,
    toReg: st.toReg || undefined,
    honorific: st.honorific || "御中",
    fromName: st.fromName,
    fromAddrHtml: st.fromAddrHtml,
    fromTel: st.fromTel || undefined,
    fromReg: st.fromReg || undefined,
    showStamp: st.showStamp,
    period: st.period,
    invoiceNo: st.invoiceNo,
    taxEnabled: st.taxEnabled,
    taxRatePercent: n(st.taxRatePercent),
    main: toDocLines(st.main),
    deduct: toDocLines(st.deduct),
    loanRepay: n(st.loanRepay),
    extraOutsourcing: n(st.extraOutsourcing),
    dueDate: st.dueDate,
    bankName: st.bankName,
    bankNo: st.bankNo,
    bankHolder: st.bankHolder,
    notes: st.notes,
  };
}

/** 差引き請求額（税込）＝保存する amount。 */
export function amountFromEditor(st: EditorState): number {
  return computeInvoiceTotals({
    main: toDocLines(st.main),
    deduct: toDocLines(st.deduct),
    taxEnabled: st.taxEnabled,
    taxRatePercent: n(st.taxRatePercent),
    loanRepay: n(st.loanRepay),
    extraOutsourcing: n(st.extraOutsourcing),
  }).total;
}

/** エディタ状態 → 保存 payload（既存キー互換＋新項目）。 */
export function payloadFromEditor(st: EditorState): Record<string, unknown> {
  const cleanLines = (lines: EditorLine[]) =>
    lines
      .filter((l) => l.title.trim() !== "" || n(l.qty) !== 0 || n(l.price) !== 0)
      .map((l) => ({ title: l.title, qty: n(l.qty), unit: l.unit, price: n(l.price) }));
  return {
    toName: st.toName,
    toAddr: st.toAddrHtml,
    toTel: st.toTel,
    toReg: st.toReg,
    honorific: st.honorific,
    fromName: st.fromName,
    fromAddr: st.fromAddrHtml,
    fromTel: st.fromTel,
    fromReg: st.fromReg,
    period: st.period,
    invoiceNo: st.invoiceNo,
    dueDate: st.dueDate,
    bankName: st.bankName,
    bankNo: st.bankNo,
    bankHolder: st.bankHolder,
    notes: st.notes,
    tableData: { main: cleanLines(st.main), deduct: cleanLines(st.deduct) },
    taxSettings: { enabled: st.taxEnabled, rate: n(st.taxRatePercent) },
    loanRepay: n(st.loanRepay),
    extraOutsourcing: n(st.extraOutsourcing),
    parties: st.parties,
  };
}

/** POST/PATCH 用の保存ボディ。 */
export function saveBodyFromEditor(st: EditorState): Record<string, unknown> {
  return {
    ...(st.id ? { id: st.id } : {}),
    section: st.section,
    counterpartyInvoiceAddressId: st.counterpartyInvoiceAddressId,
    clientName: st.kind === "incoming" ? st.fromName : st.toName,
    invoiceNo: st.invoiceNo || null,
    status: st.status,
    amount: amountFromEditor(st),
    payload: payloadFromEditor(st),
  };
}
