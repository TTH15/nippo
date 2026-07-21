// ============================================================
// 車両の金額情報のマスキング（capability: can_view_vehicle_cost）。
// 従来は can_view_vehicles だけで購入費用・リース代・初期費用回収まで見えていた。
// 配車担当のように「車両は見るが金額は見せない」ロールを作れるよう分離する。
//
// ★UI で隠すだけでは API を直接叩けば見えるため、サーバーで値そのものを落とす。
//   設計: docs/platform-design.md §2-6
// ============================================================

/** 車両レコードのうち金額に当たる列。増やしたらここに足す。 */
export const VEHICLE_COST_FIELDS = [
  "purchase_cost",
  "purchase_cost_items",
  "lease_cost",
  "monthly_insurance",
  "recovery_start_month",
  "recovery_carryover",
  "recovery_collected",
  "recovered_amount",
  "remaining_amount",
] as const;

/**
 * 金額列を取り除いた車両オブジェクトを返す（純粋関数・テスト対象）。
 * 権限がある場合は素通し。
 */
export function stripVehicleCost<T extends Record<string, unknown>>(
  vehicle: T,
  canViewCost: boolean,
): Partial<T> {
  if (canViewCost) return vehicle;
  const masked: Record<string, unknown> = { ...vehicle };
  for (const field of VEHICLE_COST_FIELDS) {
    delete masked[field];
  }
  return masked as Partial<T>;
}

export function stripVehicleCostAll<T extends Record<string, unknown>>(
  vehicles: T[],
  canViewCost: boolean,
): Partial<T>[] {
  if (canViewCost) return vehicles;
  return vehicles.map((v) => stripVehicleCost(v, false));
}
