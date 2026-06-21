// 諸報告（オイル交換・修理・経費等）に関する型。UI/DOM 非依存。
// フィールド定義の正準は server/reportKinds/fields に置く（型のみ参照＝実行時依存なし）。
import type { ReportField, VehicleMode } from "@/server/reportKinds/fields";

/** 報告種別と、その入力フィールド定義 */
export type ReportKindOption = {
  key: string;
  label: string;
  vehicleMode: VehicleMode;
  fields: ReportField[];
};
