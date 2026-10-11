import type { VehiclePlateData } from "@repo/core/types";
import type { ReportContentUnit } from "@/lib/reportContent";
import { reportVehicleNumber, type ReportVehicleNumber as NumberEvidence } from "@/lib/reportVehicleNumber";
import { VehiclePlate } from "./VehiclePlate";

export function ReportVehicleNumber({ report, className = "" }: { report: {
  vehicle_plate?: VehiclePlateData | null; content?: ReportContentUnit[];
  vehicle_number_evidence?: NumberEvidence | null; vehicle_number_unavailable?: boolean;
}; className?: string }) {
  const plate = report.vehicle_plate;
  if (plate?.number_numeric?.trim()) return <VehiclePlate vehicle={plate} compact className={`max-w-[150px] ${className}`} />;
  const evidence = reportVehicleNumber(report.content) ?? report.vehicle_number_evidence;
  if (!evidence) return <span className="text-xs text-slate-400">{report.vehicle_number_unavailable ? "番号確認待ち" : "未登録"}</span>;
  return <span className={`inline-flex max-w-[150px] flex-col items-center gap-0.5 ${className}`}>
    <span className="break-words text-xs font-semibold tabular-nums text-slate-700">{evidence.number}</span>
    <span className={`text-[10px] ${evidence.source === "ocr" ? "text-amber-700" : "text-slate-500"}`}>
      {evidence.source === "ocr" ? "原本OCR・未確認" : evidence.source === "confirmed_image" ? "原本の確認値" : "報告値"}
    </span>
  </span>;
}
