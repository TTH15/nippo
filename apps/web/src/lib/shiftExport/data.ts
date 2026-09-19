import type { VehiclePlateData } from "@/lib/components/VehiclePlate";
import type { ShiftLeaseMode } from "@/lib/shiftLease";

// ============================================================
// シフト表エクスポートの素データ。画面の描画と画像化で同じものを使う。
//   旧 shiftPdf.ts は座標を手で置いていたためプレートが文字列だった。
//   ここでは車両を VehiclePlateData のまま持ち、実物のプレートを描けるようにする。
//   ★枚数では分けない。横長・縦長になっても1枚に収める（2026-09-19 ユーザー指定）。
// ============================================================

export type ShiftExportCourse = { label: string; color: string; slotLabel?: string };
export type ShiftExportCell =
  | { kind: "off" } // 希望休
  | { kind: "none" } // 割当なし
  | { kind: "courses"; courses: ShiftExportCourse[]; plate: VehiclePlateData | null; externalVehicle: boolean };

export type ShiftExportDay = {
  iso: string;
  label: string; // "9/3（水）"
  headBg: string;
  headColor: string;
  cellBg?: string;
};

export type ShiftExportRow = {
  driverId: string;
  name: string;
  /** 契約区分（月額リース/日額リース/リースなし）。期間の初日で判定した値 */
  leaseMode: ShiftLeaseMode | null;
  cells: ShiftExportCell[];
};

export type ShiftExportData = {
  title: string;
  subtitle: string;
  days: ShiftExportDay[];
  rows: ShiftExportRow[];
  /** 日付ごとの未割当ドライバー名。空文字なら全員に予定がある */
  unassigned: string[];
};
