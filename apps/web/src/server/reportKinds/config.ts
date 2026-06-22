import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeFields, type ReportField, type VehicleMode } from "./fields";

// ============================================================
// 諸報告の「報告種別」マスタへのアクセス。
// migration 068/072 未適用でも既定値（旧ハードコード相当）で動くよう耐性を持たせる。
// ============================================================

export type ReportCapability = "none" | "oil_mileage" | "expense";

export type ReportKind = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  /** フォームビルダーのフィールド定義（順序付き）。 */
  fields: ReportField[];
  /** 車両選択の扱い。 */
  vehicleMode: VehicleMode;
  capability: ReportCapability;
  // --- 後方互換（旧フラグ・移行元。新UIでは fields を使う） ---
  usesVehicle: boolean;
  usesLocation: boolean;
  usesOdometer: boolean;
  usesDescription: boolean;
  usesAmount: boolean;
  descriptionRequired: boolean;
  descriptionLabel: string | null;
};

const CAPABILITIES: ReportCapability[] = ["none", "oil_mileage", "expense"];

export function normalizeCapability(raw: unknown): ReportCapability {
  return CAPABILITIES.includes(raw as ReportCapability) ? (raw as ReportCapability) : "none";
}

function normalizeVehicleMode(raw: unknown, usesVehicle: boolean): VehicleMode {
  if (raw === "required" || raw === "optional" || raw === "none") return raw;
  return usesVehicle ? "required" : "none"; // 072 未適用時のフォールバック
}

/** 旧フラグ（uses_*）から fields 定義を生成（072未適用時・既定種別用。migrationのbackfillと一致）。 */
function fieldsFromFlags(k: {
  usesLocation: boolean;
  usesOdometer: boolean;
  usesDescription: boolean;
  usesAmount: boolean;
  descriptionRequired: boolean;
  descriptionLabel: string | null;
  capability: ReportCapability;
}): ReportField[] {
  const fields: ReportField[] = [];
  if (k.usesLocation) fields.push({ id: "f_location", type: "short_text", label: "場所", required: true });
  if (k.usesOdometer)
    fields.push({ id: "f_odometer", type: "number", label: "走行距離 (km)", required: true, min: 0, role: k.capability === "oil_mileage" ? "odometer" : "none" });
  if (k.usesDescription)
    fields.push({ id: "f_description", type: "long_text", label: k.descriptionLabel || "内容", required: k.descriptionRequired });
  if (k.usesAmount)
    fields.push({ id: "f_amount", type: "number", label: "金額", required: true, min: 1, role: k.capability === "expense" ? "amount" : "none" });
  return fields;
}

/** migration 068 未適用時に使う既定種別（現行挙動と一致）。 */
export function defaultReportKinds(): ReportKind[] {
  const base = (over: Partial<ReportKind>): ReportKind => {
    const k: ReportKind = {
      id: over.key ?? "",
      key: "",
      label: "",
      sortOrder: 0,
      isActive: true,
      fields: [],
      vehicleMode: "required",
      capability: "none",
      usesVehicle: true,
      usesLocation: true,
      usesOdometer: false,
      usesDescription: true,
      usesAmount: false,
      descriptionRequired: true,
      descriptionLabel: null,
      ...over,
    };
    // fields/vehicleMode を旧フラグから導出（明示指定が無ければ）。
    if (k.fields.length === 0) k.fields = fieldsFromFlags(k);
    k.vehicleMode = over.vehicleMode ?? (k.usesVehicle ? "required" : "none");
    return k;
  };
  return [
    base({ key: "oil_change", label: "オイル交換", sortOrder: 1, usesOdometer: true, usesDescription: false, descriptionRequired: false, capability: "oil_mileage" }),
    base({ key: "repair", label: "修理", sortOrder: 2 }),
    base({ key: "expense", label: "経費報告", sortOrder: 3, usesAmount: true, capability: "expense" }),
    base({ key: "other", label: "その他", sortOrder: 4 }),
  ];
}

type Row = {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  uses_vehicle: boolean;
  uses_location: boolean;
  uses_odometer: boolean;
  uses_description: boolean;
  uses_amount: boolean;
  description_required: boolean;
  description_label: string | null;
  capability: string;
  fields?: unknown;
  vehicle_mode?: string;
};

function fromRow(r: Row): ReportKind {
  const usesVehicle = r.uses_vehicle !== false;
  const descriptionRequired = r.description_required !== false;
  const descriptionLabel = typeof r.description_label === "string" ? r.description_label : null;
  const capability = normalizeCapability(r.capability);
  const usesLocation = r.uses_location !== false;
  const usesOdometer = r.uses_odometer === true;
  const usesDescription = r.uses_description !== false;
  const usesAmount = r.uses_amount === true;
  // 072 適用済みなら fields を使う。未適用（空）なら旧フラグから導出。
  let fields = normalizeFields(r.fields);
  if (fields.length === 0) {
    fields = fieldsFromFlags({ usesLocation, usesOdometer, usesDescription, usesAmount, descriptionRequired, descriptionLabel, capability });
  }
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    sortOrder: Number(r.sort_order) || 0,
    isActive: r.is_active !== false,
    fields,
    vehicleMode: normalizeVehicleMode(r.vehicle_mode, usesVehicle),
    capability,
    usesVehicle,
    usesLocation,
    usesOdometer,
    usesDescription,
    usesAmount,
    descriptionRequired,
    descriptionLabel,
  };
}

/** 全種別を sort 順で取得（テーブル未作成なら既定値）。 */
export async function loadReportKinds(supabase: SupabaseClient): Promise<ReportKind[]> {
  try {
    const { data, error } = await supabase
      .from("report_kinds")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return defaultReportKinds();
    return (data as Row[]).map(fromRow);
  } catch {
    return defaultReportKinds();
  }
}

/** 有効な種別のみ。 */
export async function loadActiveReportKinds(supabase: SupabaseClient): Promise<ReportKind[]> {
  const all = await loadReportKinds(supabase);
  return all.filter((k) => k.isActive);
}
