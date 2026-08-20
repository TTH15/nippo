import { computeInvoiceTotals } from "@repo/core/logic/reward";
import { getInvoiceIssuer } from "@/config/companies";
import { INVOICE_KIND_CONFIG, resolveInvoiceKind, type InvoiceKind } from "./invoiceKinds";

/** 単価が契約上どちらの基準で決まっているか。未設定は"exclusive"（従来どおり税抜）。 */
export type TaxBasis = "exclusive" | "inclusive";

/** 帳票1行（数値化済み）。price は priceBasis 基準での入力値。 */
export type InvoiceDocLine = {
  title: string;
  qty: number;
  unit: string;
  price: number;
  priceBasis: TaxBasis;
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
  displayBasis: TaxBasis;
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
  /** 入力した単価（priceBasis基準での値）。 */
  price: string;
  /** priceの基準。コース単価と同じ考え方（税抜/税込どちらで入力したか）。既定は"exclusive"。 */
  priceBasis: TaxBasis;
  /** この行の直前で改ページする（任意位置の改ページ。行に紐づくので並べ替えにも追従）。 */
  pageBreakBefore?: boolean;
};

/** 帳票の余白（mm単位）。編集画面のツールバーから自分で調整できる。 */
export type LayoutSettings = {
  /** タイトル／宛先・自社ブロック下の余白。 */
  headerGapMm: number;
  /** サマリー表 → 請求分テーブルの間。 */
  summaryGapMm: number;
  /** 請求分 → お支払い分テーブルの間。 */
  deductGapMm: number;
};

export const DEFAULT_LAYOUT: LayoutSettings = {
  headerGapMm: 4,
  summaryGapMm: 12,
  deductGapMm: 10,
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
  /** 追加外注請求分/売上追加分。税抜表示・税込表示それぞれで独立に持つ（端数の蓄積で
   *  一致しない実額に、モードごとにぴったり合わせられるようにするため）。 */
  extraOutsourcingExclusive: string;
  extraOutsourcingInclusive: string;
  /** 帳票全体の表示基準（税抜/税込）。行のpriceBasisと異なる行は自動換算して表示する。 */
  displayBasis: TaxBasis;
  // 振込先
  dueDate: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
  notes: string;
  // レイアウト（ブロック境界の改ページ。値は "main"/"deduct"/"bank" 等のキー集合）
  blockBreaks: string[];
  // レイアウト（余白の微調整、mm単位）
  layout: LayoutSettings;
  // 管理（保存時のトップレベル列・payload保持）
  section: string;
  counterpartyInvoiceAddressId: string | null;
  status: "draft" | "pending_approval" | "approved" | "paid";
  parties: { fromParty: string; toParty: string };
  /** エディタが管理しない payload キー（attachments / source 等）。保存時にそのまま引き継ぐ。
   *  これが無いと、アップロード済み請求書を編集した瞬間に添付が消える。 */
  passthrough: Record<string, unknown>;
};

const n = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown): string => (v == null ? "" : String(v));

export function emptyLine(): EditorLine {
  return { title: "", qty: "", unit: "", price: "", priceBasis: "exclusive" };
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
    extraOutsourcingExclusive: "0",
    extraOutsourcingInclusive: "0",
    displayBasis: "exclusive",
    dueDate: "",
    // 振込先：売上＝自社口座 / 受領＝ドライバー口座（未入力）
    bankName: isIncoming ? "" : issuer.bankName,
    bankNo: isIncoming ? "" : issuer.bankNo,
    bankHolder: isIncoming ? "" : issuer.bankHolder,
    notes: "",
    blockBreaks: [],
    layout: { ...DEFAULT_LAYOUT },
    section: "Amazon",
    counterpartyInvoiceAddressId: null,
    status: "draft",
    parties: isIncoming
      ? { fromParty: "", toParty: "ace_creation" }
      : { fromParty: "ace_creation", toParty: "" },
    passthrough: {},
  };
}

/** payloadFromEditor が書き出すキー。これ以外の既存キーは passthrough で温存する。 */
const MANAGED_PAYLOAD_KEYS = new Set([
  "toName", "toAddr", "toTel", "toReg", "honorific",
  "fromName", "fromAddr", "fromTel", "fromReg",
  "period", "invoiceNo", "dueDate",
  "bankName", "bankNo", "bankHolder", "notes",
  "tableData", "taxSettings", "loanRepay",
  "extraOutsourcingExclusive", "extraOutsourcingInclusive",
  "displayBasis", "extraOutsourcing", "blockBreaks", "layout", "parties",
]);

/** エディタが管理しないキーだけを抜き出す。添付の署名URL（閲覧用の一時値）は保存しない。 */
function passthroughFromPayload(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (!MANAGED_PAYLOAD_KEYS.has(k)) out[k] = v;
  }
  if (Array.isArray(out.attachments)) {
    out.attachments = out.attachments.map((a) => {
      if (!a || typeof a !== "object") return a;
      const { url: _url, ...rest } = a as Record<string, unknown>;
      return rest;
    });
  }
  return out;
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

function layoutFromPayload(v: unknown): LayoutSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  const pick = (key: keyof LayoutSettings) =>
    o[key] != null && Number.isFinite(Number(o[key])) ? Number(o[key]) : DEFAULT_LAYOUT[key];
  return {
    headerGapMm: pick("headerGapMm"),
    summaryGapMm: pick("summaryGapMm"),
    deductGapMm: pick("deductGapMm"),
  };
}

function linesFromPayload(v: unknown): EditorLine[] {
  // 配列でない（＝未保存・旧データ）場合だけ空1行を補う。保存済みの空配列（＝ユーザーが
  // 意図的に0行にした）はそのまま空配列として尊重する（再読込で復活しないように）。
  if (!Array.isArray(v)) return [emptyLine()];
  return v.map((r) => ({
    title: s(r?.title),
    qty: r?.qty == null ? "" : String(r.qty),
    unit: s(r?.unit),
    price: r?.price == null ? "" : String(r.price),
    priceBasis: r?.priceBasis === "inclusive" ? "inclusive" : "exclusive",
    pageBreakBefore: r?.pageBreakBefore ? true : undefined,
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
    // 現行データは保存値を優先。旧データは outgoing の既定値へ戻し、
    // 日本語の請求元名でも印影が消えないようにする。
    showStamp: p.showStamp !== undefined ? Boolean(p.showStamp) : base.showStamp,
    period: s(p.period || p.subject) || base.period,
    invoiceNo: s(p.invoiceNo) || s(inv.invoiceNo),
    taxEnabled: tax.enabled !== undefined ? Boolean(tax.enabled) : true,
    taxRatePercent: tax.rate !== undefined ? String(tax.rate) : "10",
    main: linesFromPayload(p?.tableData?.main),
    deduct: linesFromPayload(p?.tableData?.deduct),
    loanRepay: p.loanRepay != null ? String(p.loanRepay) : "0",
    // 旧仕様(単一のextraOutsourcing)からの後方互換: 専用フィールドが無ければ旧値を
    // exclusive側に引き継ぐ（旧データは常にexclusive表示で計算されていたため）。
    extraOutsourcingExclusive:
      p.extraOutsourcingExclusive != null
        ? String(p.extraOutsourcingExclusive)
        : p.extraOutsourcing != null
          ? String(p.extraOutsourcing)
          : "0",
    extraOutsourcingInclusive: p.extraOutsourcingInclusive != null ? String(p.extraOutsourcingInclusive) : "0",
    displayBasis: p.displayBasis === "inclusive" ? "inclusive" : "exclusive",
    dueDate: s(p.dueDate),
    bankName: s(p.bankName) || base.bankName,
    bankNo: s(p.bankNo) || base.bankNo,
    bankHolder: s(p.bankHolder) || base.bankHolder,
    notes: s(p.notes),
    blockBreaks: Array.isArray(p.blockBreaks)
      ? p.blockBreaks.filter((x: unknown): x is string => typeof x === "string")
      : [],
    layout: layoutFromPayload(p.layout),
    section: s(inv.section) || base.section,
    counterpartyInvoiceAddressId: inv.counterpartyInvoiceAddressId ?? null,
    status: inv.status ?? "draft",
    parties: {
      fromParty: s(p?.parties?.fromParty) || base.parties.fromParty,
      toParty: s(p?.parties?.toParty) || base.parties.toParty,
    },
    passthrough: passthroughFromPayload(p),
  };
}

function toDocLines(lines: EditorLine[]): InvoiceDocLine[] {
  return lines.map((l) => ({
    title: l.title,
    qty: n(l.qty),
    unit: l.unit,
    price: n(l.price),
    priceBasis: l.priceBasis === "inclusive" ? "inclusive" : "exclusive",
  }));
}

/** 現在の表示基準(displayBasis)側の追加外注請求分/売上追加分。 */
export function currentExtraOutsourcing(st: EditorState): number {
  return n(st.displayBasis === "inclusive" ? st.extraOutsourcingInclusive : st.extraOutsourcingExclusive);
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
    extraOutsourcing: currentExtraOutsourcing(st),
    displayBasis: st.displayBasis,
    dueDate: st.dueDate,
    bankName: st.bankName,
    bankNo: st.bankNo,
    bankHolder: st.bankHolder,
    notes: st.notes,
  };
}

/** 差引き請求額（現在の表示基準での金額）＝保存する amount。 */
export function amountFromEditor(st: EditorState): number {
  return computeInvoiceTotals({
    main: toDocLines(st.main),
    deduct: toDocLines(st.deduct),
    taxEnabled: st.taxEnabled,
    taxRatePercent: n(st.taxRatePercent),
    loanRepay: n(st.loanRepay),
    extraOutsourcing: currentExtraOutsourcing(st),
    displayBasis: st.displayBasis,
  }).total;
}

/** エディタ状態 → 保存 payload（既存キー互換＋新項目）。 */
export function payloadFromEditor(st: EditorState): Record<string, unknown> {
  const cleanLines = (lines: EditorLine[]) =>
    lines
      .filter((l) => l.title.trim() !== "" || n(l.qty) !== 0 || n(l.price) !== 0)
      .map((l) => ({
        title: l.title,
        qty: n(l.qty),
        unit: l.unit,
        price: n(l.price),
        priceBasis: l.priceBasis === "inclusive" ? "inclusive" : "exclusive",
        ...(l.pageBreakBefore ? { pageBreakBefore: true } : {}),
      }));
  return {
    // 未管理キー（attachments / source 等）を先に展開し、管理キーで上書きする
    ...st.passthrough,
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
    extraOutsourcingExclusive: n(st.extraOutsourcingExclusive),
    extraOutsourcingInclusive: n(st.extraOutsourcingInclusive),
    displayBasis: st.displayBasis,
    // 旧仕様の読み手（存在すれば）向けに、現在の表示基準側の値を引き続き書いておく。
    extraOutsourcing: currentExtraOutsourcing(st),
    blockBreaks: st.blockBreaks,
    layout: st.layout,
    parties: st.parties,
  };
}

/**
 * 請求先がドライバー個人か（自社 → ドライバーの請求書）。
 * 法人アドレス（counterpartyInvoiceAddressId）は持たず、toParty に "drv-<id>" を入れて表す。
 */
export function isDriverRecipient(st: EditorState): boolean {
  return st.kind === "outgoing" && st.parties.toParty.startsWith("drv-");
}

/** 保存前バリデーション。問題があればユーザー向けメッセージの配列を返す（空＝OK）。 */
export function validateForSave(st: EditorState): string[] {
  const errors: string[] = [];
  if (st.kind === "outgoing") {
    // ドライバー個人宛は法人アドレス帳を経由しないため、取引先IDは要求しない。
    if (!isDriverRecipient(st) && !st.counterpartyInvoiceAddressId) {
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

/**
 * 印刷（PDF保存）時の既定ファイル名。ブラウザは document.title を初期ファイル名に使うため、
 * 印刷直前にこの文字列を title へ差し替える。例: "202605_御請求書_合同会社fiants"
 */
export function invoiceFileName(st: EditorState): string {
  const { start } = parsePeriodJa(st.period);
  const ym = start ? `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}` : "";
  const docTitle = (INVOICE_KIND_CONFIG[st.kind]?.docTitle ?? "請求書").replace(/\s+/g, "");
  // 売上＝請求先(取引先)、受領＝請求元(ドライバー)を識別名に使う。
  const party = st.kind === "incoming" ? st.fromName : st.toName;
  const sanitize = (x: string) => x.replace(/[\\/:*?"<>|]/g, "").trim();
  return [ym, docTitle, sanitize(party)].filter(Boolean).join("_") || "請求書";
}

/** 郵便番号・住所から表示用HTML（〒付き）を組み立てる。取引先・ドライバー双方の住所補完で共用する。 */
export function addrHtml(postal?: string | null, address?: string | null): string {
  const p = s(postal);
  const a = s(address);
  if (!p && !a) return "";
  return p ? `〒${p}<br/>${a}` : a;
}

/** 請求先住所が空のとき、紐づく取引先アドレスで補完（読み取りプレビュー用）。 */
export function applyCounterparty(st: EditorState, addr?: CounterpartyAddress): EditorState {
  if (!addr) return st;
  const html = addrHtml(addr.postal_code, addr.address);
  return {
    ...st,
    toName: st.toName || s(addr.name),
    toAddrHtml: st.toAddrHtml || html,
    toTel: st.toTel || s(addr.phone),
    toReg: st.toReg || s(addr.invoice_no),
  };
}
