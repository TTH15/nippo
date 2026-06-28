import { computeInvoiceTotals } from "@repo/core/logic/reward";
import { getInvoiceIssuer } from "@/config/companies";
import { resolveInvoiceKind, type InvoiceKind } from "./invoiceKinds";

/** 帳票1行（税抜単価モデル・数値化済み）。 */
export type InvoiceDocLine = {
  title: string;
  qty: number;
  unit: string;
  price: number;
};

/** 帳票表示データ（数値化済み）。 */
export type InvoiceDocData = {
  kind: InvoiceKind;
  toName: string;
  toAddrHtml: string;
  toTel?: string;
  toReg?: string;
  honorific: string;
  fromName: string;
  fromAddrHtml: string;
  fromTel?: string;
  fromReg?: string;
  showStamp: boolean;
  period: string;
  invoiceNo: string;
  taxEnabled: boolean;
  taxRatePercent: number;
  main: InvoiceDocLine[];
  deduct: InvoiceDocLine[];
  loanRepay: number;
  extraOutsourcing: number;
  dueDate: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
  notes: string;
};

/** invoice_addresses の1件（請求先住所の補完用）。 */
export type CounterpartyAddress = {
  name?: string;
  postal_code?: string;
  address?: string;
  phone?: string;
  invoice_no?: string;
};

/** 対象期間の既定値（前月の1日〜末日）。 */
export function defaultTargetPeriod(now: Date = new Date()): string {
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000);
  const y = lastOfPrevMonth.getFullYear();
  const m = lastOfPrevMonth.getMonth() + 1;
  const lastDay = lastOfPrevMonth.getDate();
  return `${y}年${m}月1日〜${y}年${m}月${lastDay}日`;
}

// ── 日付の相互変換（DatePicker ⇔ 保存文字列）。期間は表示文字列を正本に保つ ──

/** ISO日付(YYYY-MM-DD…) → Date（解析不能なら undefined）。 */
export function parseIsoDate(v: string | null | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Date → ISO日付(YYYY-MM-DD)。undefined は空文字。 */
export function toIsoDate(d: Date | undefined): string {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 日付文字列を「YYYY年M月D日」で表示。ISO以外（自由入力の旧値）はそのまま返す。 */
export function formatDateJa(v: string | null | undefined): string {
  const d = parseIsoDate(v);
  if (d) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return String(v ?? "");
}

/** "YYYY-MM" → その月の1日〜末日の対象期間文字列。請求月に対象期間を一致させる。 */
export function periodForMonth(month: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(y, mo, 0).getDate();
  return formatPeriodJa(new Date(y, mo - 1, 1), new Date(y, mo - 1, lastDay));
}

/** 開始/終了 → 「YYYY年M月D日〜YYYY年M月D日」。片方のみでも可。 */
export function formatPeriodJa(start?: Date, end?: Date): string {
  const f = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  if (start && end) return `${f(start)}〜${f(end)}`;
  if (start) return f(start);
  if (end) return f(end);
  return "";
}

/** 期間表示文字列 → 開始/終了（「YYYY年M月D日」を最大2件拾う）。解析できなければ空。 */
export function parsePeriodJa(period: string | null | undefined): { start?: Date; end?: Date } {
  const re = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
  const dates: Date[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(period ?? ""))) !== null) {
    dates.push(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return { start: dates[0], end: dates[1] };
}

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
  // レイアウト（お支払い/控除テーブルの前で強制改ページ）
  pageBreakBeforeDeduct: boolean;
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

/** 種別ごとの空エディタ状態。自社（請求元）情報は config/companies から自動補完。 */
export function blankEditorState(kind: InvoiceKind): EditorState {
  const isIncoming = kind === "incoming";
  const issuer = getInvoiceIssuer();
  return {
    kind,
    // 受領：請求先＝自社 / 売上：請求先＝取引先（未選択）
    toName: isIncoming ? issuer.name : "",
    toAddrHtml: isIncoming ? issuer.addressHtml : "",
    toTel: isIncoming ? issuer.tel : "",
    toReg: isIncoming ? issuer.regNo : "",
    honorific: "御中",
    // 受領：請求元＝ドライバー（未入力）/ 売上：請求元＝自社
    fromName: isIncoming ? "" : issuer.name,
    fromAddrHtml: isIncoming ? "" : issuer.addressHtml,
    fromTel: isIncoming ? "" : issuer.tel,
    fromReg: isIncoming ? "" : issuer.regNo,
    showStamp: isIncoming ? false : Boolean(issuer.stampPath),
    period: defaultTargetPeriod(),
    invoiceNo: "",
    taxEnabled: true,
    taxRatePercent: "10",
    main: [emptyLine()],
    deduct: [emptyLine()],
    loanRepay: "0",
    extraOutsourcing: "0",
    dueDate: "",
    // 振込先：売上＝自社口座 / 受領＝ドライバー口座（未入力）
    bankName: isIncoming ? "" : issuer.bankName,
    bankNo: isIncoming ? "" : issuer.bankNo,
    bankHolder: isIncoming ? "" : issuer.bankHolder,
    notes: "",
    pageBreakBeforeDeduct: false,
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
    toAddrHtml: s(p.toAddr) || base.toAddrHtml,
    toTel: s(p.toTel) || base.toTel,
    toReg: s(p.toReg) || base.toReg,
    honorific: s(p.honorific || p.toHonorific) || "御中",
    fromName,
    fromAddrHtml: s(p.fromAddr) || base.fromAddrHtml,
    fromTel: s(p.fromTel) || base.fromTel,
    fromReg: s(p.fromReg) || base.fromReg,
    showStamp:
      s(p?.parties?.fromParty) === "ace_creation" || /ACE\s*CREATION/i.test(fromName),
    period: s(p.period || p.subject) || base.period,
    invoiceNo: s(p.invoiceNo) || s(inv.invoiceNo),
    taxEnabled: tax.enabled !== undefined ? Boolean(tax.enabled) : true,
    taxRatePercent: tax.rate !== undefined ? String(tax.rate) : "10",
    main: linesFromPayload(p?.tableData?.main),
    deduct: linesFromPayload(p?.tableData?.deduct),
    loanRepay: p.loanRepay != null ? String(p.loanRepay) : "0",
    extraOutsourcing: p.extraOutsourcing != null ? String(p.extraOutsourcing) : "0",
    dueDate: s(p.dueDate),
    bankName: s(p.bankName) || base.bankName,
    bankNo: s(p.bankNo) || base.bankNo,
    bankHolder: s(p.bankHolder) || base.bankHolder,
    notes: s(p.notes),
    pageBreakBeforeDeduct: Boolean(p.pageBreakBeforeDeduct),
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
    pageBreakBeforeDeduct: st.pageBreakBeforeDeduct,
    parties: st.parties,
  };
}

/** 保存前バリデーション。問題があればユーザー向けメッセージの配列を返す（空＝OK）。 */
export function validateForSave(st: EditorState): string[] {
  const errors: string[] = [];
  if (st.kind === "outgoing") {
    if (!st.counterpartyInvoiceAddressId) {
      errors.push("請求先（取引先）が選択されていません。上部のメニューから請求先を選んでください。");
    }
    if (!st.toName.trim()) errors.push("請求先の名称が空です。");
  } else {
    if (!st.parties.fromParty.startsWith("drv-")) {
      errors.push("請求元（ドライバー）が選択されていません。上部のメニューから請求元を選んでください。");
    }
    if (!st.fromName.trim()) errors.push("請求元の名称が空です。");
  }
  const hasMainLine = st.main.some((l) => l.title.trim() !== "" && (n(l.qty) !== 0 || n(l.price) !== 0));
  if (!hasMainLine) {
    errors.push(`${st.kind === "incoming" ? "報酬明細" : "請求分"}に有効な明細が1行もありません（摘要と金額を入力してください）。`);
  }
  if (!st.period.trim()) errors.push("対象期間が未設定です。");
  return errors;
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

/** 請求先住所が空のとき、紐づく取引先アドレスで補完（読み取りプレビュー用）。 */
export function applyCounterparty(st: EditorState, addr?: CounterpartyAddress): EditorState {
  if (!addr) return st;
  const p = s(addr.postal_code);
  const a = s(addr.address);
  const html = !p && !a ? "" : p ? `〒${p}<br/>${a}` : a;
  return {
    ...st,
    toName: st.toName || s(addr.name),
    toAddrHtml: st.toAddrHtml || html,
    toTel: st.toTel || s(addr.phone),
    toReg: st.toReg || s(addr.invoice_no),
  };
}
