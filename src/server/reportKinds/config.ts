import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 諸報告の「報告種別」マスタへのアクセス。
// migration 068 未適用でも既定値（旧ハードコード相当）で動くよう耐性を持たせる。
// ============================================================

export type ReportCapability = "none" | "oil_mileage" | "expense";

export type ReportKind = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  usesLocation: boolean;
  usesOdometer: boolean;
  usesDescription: boolean;
  usesAmount: boolean;
  descriptionRequired: boolean;
  descriptionLabel: string | null;
  capability: ReportCapability;
};

const CAPABILITIES: ReportCapability[] = ["none", "oil_mileage", "expense"];

export function normalizeCapability(raw: unknown): ReportCapability {
  return CAPABILITIES.includes(raw as ReportCapability) ? (raw as ReportCapability) : "none";
}

/** migration 068 未適用時に使う既定種別（現行挙動と一致）。 */
export function defaultReportKinds(): ReportKind[] {
  const base = (over: Partial<ReportKind>): ReportKind => ({
    id: over.key ?? "",
    key: "",
    label: "",
    sortOrder: 0,
    isActive: true,
    usesLocation: true,
    usesOdometer: false,
    usesDescription: true,
    usesAmount: false,
    descriptionRequired: true,
    descriptionLabel: null,
    capability: "none",
    ...over,
  });
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
  uses_location: boolean;
  uses_odometer: boolean;
  uses_description: boolean;
  uses_amount: boolean;
  description_required: boolean;
  description_label: string | null;
  capability: string;
};

function fromRow(r: Row): ReportKind {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    sortOrder: Number(r.sort_order) || 0,
    isActive: r.is_active !== false,
    usesLocation: r.uses_location !== false,
    usesOdometer: r.uses_odometer === true,
    usesDescription: r.uses_description !== false,
    usesAmount: r.uses_amount === true,
    descriptionRequired: r.description_required !== false,
    descriptionLabel: typeof r.description_label === "string" ? r.description_label : null,
    capability: normalizeCapability(r.capability),
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
