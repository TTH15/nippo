// 請求書の種別ごとの設定（売上請求書 / 受領請求書）。
// デザイン・サマリー項目・色をタイプ別に「柔軟に」切り替えるための単一の定義。
// 将来 payload などで上書きできるよう、純粋なデータ（設定）として持つ。

export type InvoiceKind = "outgoing" | "incoming";

/** サマリー行の金額ソース。 */
export type SummaryValueRef =
  | { kind: "total"; key: "billSubtotal" | "deductSubtotal" | "billGross" | "deductGross" | "total" }
  | { kind: "manual"; field: "loanRepay" | "extraOutsourcing" };

/** サマリー行（差引き行は finalLabel で別途レンダリング）。 */
export type SummaryRowDef = {
  label: string;
  value: SummaryValueRef;
  /** ▲を金額前に表示（差引き計算上のマイナス項目）。 */
  minus?: boolean;
  /** 手入力欄（読み取りプレビューでは表示のみ。将来エディタで編集可）。 */
  editable?: boolean;
};

/** 色テーマ（白文字が乗る前提の濃色）。 */
export type InvoiceTheme = {
  brand: string; // タイトル・サマリー・差引き帯
  brandSoft: string; // サマリーラベル背景
  bill: string; // 上段テーブル（請求/報酬）
  billSoft: string;
  deduct: string; // 下段テーブル（お支払い/控除）
  deductSoft: string;
};

export type InvoiceKindConfig = {
  kind: InvoiceKind;
  /** 帳票タイトル（例: 御 請 求 書 / 受 領 請 求 書）。 */
  docTitle: string;
  /** ご請求金額見出しのラベル。 */
  amountHeadlineLabel: string;
  /** 上段テーブル見出し。 */
  billSectionTitle: string;
  /** 下段テーブル見出し。 */
  deductSectionTitle: string;
  /** 下段（お支払い/控除）テーブルを表示するか。 */
  showDeductTable: boolean;
  /** サマリー（差引き以外）の行。 */
  summaryRows: SummaryRowDef[];
  /** 差引き（最終額）行のラベル。 */
  finalLabel: string;
  theme: InvoiceTheme;
};

const COOL: InvoiceTheme = {
  brand: "#1f3b66",
  brandSoft: "#eaf0f7",
  bill: "#1f5fa8",
  billSoft: "#e8f0fa",
  deduct: "#1f7a5f",
  deductSoft: "#e6f3ed",
};

const WARM: InvoiceTheme = {
  brand: "#9a3412", // テラコッタ（タイトル・サマリー・差引帯）
  brandSoft: "#fbeae0",
  bill: "#c2410c", // オレンジ（報酬明細）
  billSoft: "#fdeee4",
  deduct: "#92400e", // 焦茶・アンバー（控除）
  deductSoft: "#f5ecdc",
};

export const INVOICE_KIND_CONFIG: Record<InvoiceKind, InvoiceKindConfig> = {
  // 売上請求書：自社 → 他社（取引先）に請求
  outgoing: {
    kind: "outgoing",
    docTitle: "御 請 求 書",
    amountHeadlineLabel: "ご請求金額",
    billSectionTitle: "請求分",
    deductSectionTitle: "お支払い分",
    showDeductTable: true,
    summaryRows: [
      { label: "請求額 税込合計", value: { kind: "total", key: "billGross" } },
      { label: "お支払い分 税込合計", value: { kind: "total", key: "deductGross" }, minus: true },
    ],
    finalLabel: "差引き請求額",
    theme: COOL,
  },
  // 受領請求書：ドライバー → 自社に請求（システム上は自社が代理作成）
  incoming: {
    kind: "incoming",
    docTitle: "受 領 請 求 書",
    amountHeadlineLabel: "お支払い金額",
    billSectionTitle: "報酬明細",
    deductSectionTitle: "控除",
    showDeductTable: true,
    summaryRows: [
      { label: "報酬額 税込合計", value: { kind: "total", key: "billGross" } },
      { label: "控除 税込合計", value: { kind: "total", key: "deductGross" }, minus: true },
      { label: "借入返済", value: { kind: "manual", field: "loanRepay" }, minus: true, editable: true },
      { label: "追加外注支払い（税込）", value: { kind: "manual", field: "extraOutsourcing" }, editable: true },
    ],
    finalLabel: "差引き支払額",
    theme: WARM,
  },
};

/** payload.parties から種別を推定（受領＝請求先が自社・請求元がドライバー）。 */
export function resolveInvoiceKind(parties: unknown): InvoiceKind {
  const p = (parties ?? {}) as { fromParty?: unknown; toParty?: unknown };
  const to = String(p.toParty ?? "");
  const from = String(p.fromParty ?? "");
  if (to === "ace_creation" && from.startsWith("drv-")) return "incoming";
  return "outgoing";
}
