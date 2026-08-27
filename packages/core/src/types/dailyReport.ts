// 日報フォーム（新モデル / submit-v2）の型。UI/DOM 非依存。
// その日のシフト（コース）ごとに unit と報告項目を動的描画するための構造。

/** 日報フォームの入力項目定義 */
export type FieldDef = {
  fieldKey: string;
  label: string;
  inputType: "INT" | "TEXT" | "TIME" | "BOOL";
  groupLabel: string | null;
  required: boolean;
};

/** 報告単位（unit）＝請求単位ごとの入力フィールド束 */
export type UnitDef = {
  id: string;
  name: string;
  code: string | null;
  billingType: "PER_PIECE" | "FIXED";
  fields: FieldDef[];
};

/** その日のシフト（コース）1件ぶんの日報フォーム */
export type ShiftForm = {
  courseId: string;
  /** 便。0はサイクル導入前の「コース全体」または便を使わないコース。 */
  cycleNo?: number;
  cycleLabel?: string | null;
  courseName: string;
  color: string | null;
  carrierId: string | null;
  carrierName: string;
  units: UnitDef[];
  existing: {
    vehicleId: string | null;
    meterValue: number | null;
    values: Record<string, Record<string, number | string>>;
  } | null;
};

/** 入力値のネストマップ: values[courseId:cycleNo][unitId][fieldKey] = string */
export type ValueMap = Record<string, Record<string, Record<string, string>>>;

/** 日報送信payloadの1項目（report_entries の1行に対応）。 */
export type ReportEntry = {
  unitId: string;
  fieldKey: string;
  valueNum: number | null;
  valueText: string | null;
};

/** 日報送信payloadの1シフト分（POST /api/reports/v2 の items 要素）。 */
export type ReportItem = {
  courseId: string;
  cycleNo: number;
  carrierId: string | null;
  vehicleId: string | null;
  meterValue: number | null;
  entries: ReportEntry[];
};
