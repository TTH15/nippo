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
  price?: number | string;
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
