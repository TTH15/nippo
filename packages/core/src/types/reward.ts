// 報酬・給与・請求書に関する型。UI/DOM 非依存。

/** 報酬ログ明細（日次収入・手当・控除など） */
export type RewardLogDetail = {
  log_date: string;
  type_name: string;
  content: string;
  amount: number;
};

/** 固定費控除の明細 */
export type FixedExpenseDetail = {
  id: string;
  name: string;
  amount: number;
};

/** 任意経費控除の明細 */
export type OptionalExpenseDetail = {
  id: string;
  name: string;
  amount: number;
};

/** 月次の報酬サマリ */
export type RewardsSummary = {
  month: string;
  startDate: string;
  endDate: string;
  incomeLog: number;
  variableDeductions: number;
  fixedDeductions: number;
  optionalDeductions?: number;
  leaseDeductions?: number;
  net: number;
  logDetails: RewardLogDetail[];
  dailyIncomeDetails?: RewardLogDetail[];
  fixedDetails: FixedExpenseDetail[];
  optionalDetails?: OptionalExpenseDetail[];
};

/** 請求書プレビューの明細行（payload.tableData.main / deduct の各行） */
export type InvoiceRow = {
  title?: string;
  qty?: number | string;
  /** 単位（新仕様。例: 件 / 回 / 式）。未設定でも後方互換。 */
  unit?: string;
  /** 税抜単価。 */
  price?: number | string;
};

/**
 * 請求書合計計算の入力（新仕様：税抜単価モデル）。
 * - main: 請求分、deduct: お支払い分（控除）
 * - 税は各セクションの税抜小計に対する外税
 * - loanRepay（借入返済）はマイナス、extraOutsourcing（追加外注支払い・税込）はプラス
 */
export type InvoiceTotalsInput = {
  main: InvoiceRow[];
  deduct: InvoiceRow[];
  taxEnabled: boolean;
  taxRatePercent: number;
  loanRepay: number;
  extraOutsourcing: number;
};

/** 請求書合計計算の出力。 */
export type InvoiceTotals = {
  /** 請求分 税抜小計 */
  billSubtotal: number;
  /** お支払い分 税抜小計 */
  deductSubtotal: number;
  /** 請求分 消費税額 */
  billTax: number;
  /** お支払い分 消費税額 */
  deductTax: number;
  /** 請求分 税込合計 */
  billGross: number;
  /** お支払い分 税込合計 */
  deductGross: number;
  /** 差引き請求額（税込）＝ 請求 − お支払い − 借入返済 + 追加外注 */
  total: number;
};

/** 請求書プレビューの添付（payload.attachments の各要素） */
export type InvoiceAttachment = {
  name?: string;
  type?: string;
  dataUrl?: string;
};

/** ドライバー自身の請求書 */
export type MyInvoice = {
  id: string;
  month: string;
  issueDate: string;
  amount: number;
  status: "draft" | "pending_approval" | "approved" | "paid";
  invoiceNo: string;
  // 請求書プレイロード（uploaded_document 等、形が一定しないため any 維持）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
};
