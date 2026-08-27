// ============================================================
// 集計刷新: 集計ユーティリティの型定義
// 新スキーマ（carriers/units/unit_fields/course_unit_rates/course_fixed_rates/
// daily_reports_v2/report_entries/ledger_entries）から正規化した入力形。
// ここは DB 非依存の純データ型のみ（compute.ts も Supabase に依存しない）。
// ============================================================

export type BillingType = "PER_PIECE" | "FIXED";

export type UnitFieldDef = {
  fieldKey: string;
  /** 従量課金の数量として使うフィールドか */
  isBillable: boolean;
};

export type UnitDef = {
  id: string;
  carrierId: string;
  code: string | null;
  billingType: BillingType;
  fields: UnitFieldDef[];
};

/** 従量分: course × unit ごとの単価 */
export type CourseUnitRate = {
  courseId: string;
  cycleNo?: number;
  unitId: string;
  revenuePerUnit: number;
  profitPerUnit: number;
  payoutPerUnit: number;
  revenueContractAmount?: number;
  payoutContractAmount?: number;
  revenueQuantityRule?: import("@/server/billing/quantityRule").QuantityRule;
  payoutQuantityRule?: import("@/server/billing/quantityRule").QuantityRule;
};

/** 固定(日当)分: course 単位（従量と加算される） */
export type CourseFixedRate = {
  courseId: string;
  cycleNo?: number;
  fixedRevenue: number;
  fixedProfit: number;
  fixedPayout: number;
  revenueContractAmount?: number;
  payoutContractAmount?: number;
};

/**
 * コースの計算方式（migration 141）。NONE は「その契約が存在しない」ことを表し、
 * 単価行に古い値が残っていても集計へ載せない。
 * 支払が NONE のコースは支払0＝売上全額が自社利益になる。
 */
export type RateMode = "NONE" | "PER_PIECE" | "FIXED" | "BOTH";

export type TaxBasis = "exclusive" | "inclusive";

/**
 * 集計に必要なコース側のメタ情報。
 * 計算方式に加えて「契約が税抜／税込どちらで決まっているか」も持つ。
 * 税込表示は保存値(税抜)の1.1倍ではなく契約原額から積み直すため、この基準が要る。
 */
export type CourseBillingMeta = {
  courseId: string;
  revenueRateMode: RateMode;
  payoutRateMode: RateMode;
  revenuePieceBasis: TaxBasis;
  payoutPieceBasis: TaxBasis;
  revenueFixedBasis: TaxBasis;
  payoutFixedBasis: TaxBasis;
};

export type CourseFixedRateBundle = {
  courseId: string;
  requiredCycleNos: number[];
  fixedRevenue: number | null;
  fixedPayout: number | null;
  /** 契約原額（税込契約なら税込額そのもの）。税込表示の積み直しに使う */
  revenueContractAmount?: number | null;
  payoutContractAmount?: number | null;
};

export type ReportEntry = {
  unitId: string;
  fieldKey: string;
  valueNum: number;
};

export type DailyReport = {
  id: string;
  driverId: string;
  reportDate: string; // YYYY-MM-DD
  courseId: string | null;
  cycleNo?: number;
  carrierId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rateSnapshot?: import("./rateSnapshot").ReportRateSnapshot | null;
  entries: ReportEntry[];
};

export type LedgerEntry = {
  entryDate: string; // YYYY-MM-DD
  revenueDelta: number;
  profitDelta: number;
  payoutDelta: number;
  targetDriverId: string | null;
  courseId: string | null;
  counterpartyInvoiceAddressId: string | null;
};

export type Money = {
  revenue: number;
  profit: number;
  payout: number;
};

export type ContributionSource = "auto_per_piece" | "auto_fixed" | "ledger";

/**
 * 集計の最小単位。1本の report / ledger から複数生成され、
 * 任意の軸（date/driver/course/carrier/unit/counterparty）で sumBy して集計する。
 */
export type Contribution = {
  date: string;
  driverId: string | null;
  courseId: string | null;
  carrierId: string | null;
  unitId: string | null; // 従量(per-piece)のみ。固定/台帳は null
  counterpartyId: string | null;
  source: ContributionSource;
  /** 税抜（会計上の売上高。集計・請求の正本） */
  revenue: number;
  profit: number;
  payout: number;
  /** 税込（契約原額から積み直した表示用の値。税抜×1.1 とは1円単位で一致しない） */
  revenueIncl: number;
  profitIncl: number;
  payoutIncl: number;
};
