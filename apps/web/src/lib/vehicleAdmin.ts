export type VehicleFormTab = "basic" | "work" | "cost";

export type VehicleFormField =
  | "identity"
  | "currentMileage"
  | "lastOilChangeMileage"
  | "oilChangeInterval"
  | "leaseCost"
  | "monthlyInsurance"
  | "recoveryCarryover";

export type VehicleFormIssue = {
  field: VehicleFormField;
  tab: VehicleFormTab;
  message: string;
};

type VehicleFormValues = {
  manufacturer?: unknown;
  brand?: unknown;
  currentMileage?: unknown;
  lastOilChangeMileage?: unknown;
  oilChangeInterval?: unknown;
  leaseCost?: unknown;
  monthlyInsurance?: unknown;
  recoveryCarryover?: unknown;
};

const INTEGER_FIELDS: Array<{
  field: Exclude<VehicleFormField, "identity">;
  tab: "work" | "cost";
  label: string;
}> = [
  { field: "currentMileage", tab: "work", label: "現在メーター" },
  { field: "lastOilChangeMileage", tab: "work", label: "前回オイル交換時" },
  { field: "oilChangeInterval", tab: "work", label: "交換間隔" },
  { field: "leaseCost", tab: "cost", label: "月々リース代" },
  { field: "monthlyInsurance", tab: "cost", label: "月額保険料" },
  { field: "recoveryCarryover", tab: "cost", label: "回収済み繰越" },
];

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isBlank(value: unknown): boolean {
  return value === "" || value === null || value === undefined;
}

/** 車両フォームと API で共通利用する、利用者向けの入力検証。 */
export function validateVehicleForm(
  values: VehicleFormValues,
  options: { requireIdentity?: boolean } = {},
): VehicleFormIssue[] {
  const issues: VehicleFormIssue[] = [];

  if (options.requireIdentity !== false && !hasText(values.manufacturer) && !hasText(values.brand)) {
    issues.push({
      field: "identity",
      tab: "basic",
      message: "車種を選択してください。その他の車両はメーカー名または車種名を入力してください。",
    });
  }

  for (const { field, tab, label } of INTEGER_FIELDS) {
    const value = values[field];
    if (isBlank(value)) continue;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
      issues.push({ field, tab, message: `${label}は0以上の整数で入力してください。` });
    }
  }

  return issues;
}

/** 空欄は DB の既定値へ寄せ、検証済みの値は整数へ揃える。 */
export function normalizeVehicleInteger(value: unknown, fallback: number): number {
  if (isBlank(value)) return fallback;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

/** 登録日時が古い車両から並べ、同時刻だけ ID で順序を固定する。 */
export function sortVehiclesByRegistration<T extends { created_at?: string | null; id?: string | null }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const created = (a.created_at ?? "").localeCompare(b.created_at ?? "");
    if (created !== 0) return created;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}
