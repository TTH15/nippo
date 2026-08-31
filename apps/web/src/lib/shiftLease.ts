/** 配車画面で使う契約区分のみ。料金・請求情報は含めない。 */
export type ShiftLease = {
  id: string;
  driver_id: string;
  mode: "MONTHLY" | "DAILY";
  valid_from: string;
  valid_to: string | null;
};
export const SHIFT_LEASE_NAMES = { MONTHLY: "月額リース", DAILY: "日額リース", NONE: "リースなし" };
export type ShiftLeaseMode = keyof typeof SHIFT_LEASE_NAMES;
export type ShiftLeaseFilter = "all" | ShiftLeaseMode;

export function indexShiftLeases(leases: ShiftLease[] | null | undefined) {
  if (!leases) return null; // 取得失敗・未取得と、契約が0件の正常応答を区別する。
  const index = new Map<string, ShiftLease[]>();
  // 契約設定APIと同じ優先順位。重複した旧データでも入力順に依存しない。
  for (const lease of [...leases].sort((a, b) => b.valid_from.localeCompare(a.valid_from) || a.id.localeCompare(b.id))) {
    const rows = index.get(lease.driver_id) ?? [];
    rows.push(lease);
    index.set(lease.driver_id, rows);
  }
  return index;
}

export function shiftLeaseMode(index: ReturnType<typeof indexShiftLeases>, driverId: string, date: string): ShiftLeaseMode | null {
  if (!index) return null;
  return index.get(driverId)?.find(lease => lease.valid_from <= date && (!lease.valid_to || lease.valid_to >= date))?.mode ?? "NONE";
}

/** 表示専用。名簿・配車候補・保存順は変更せず、区分内は名簿順を維持する。 */
export function shiftLeaseGroups<T extends { id: string }>(drivers: T[], index: ReturnType<typeof indexShiftLeases>, date: string, filter: ShiftLeaseFilter, grouped: boolean) {
  const rows = drivers.filter(driver => !index || filter === "all" || shiftLeaseMode(index, driver.id, date) === filter);
  if (!index || !grouped) return [{ mode: null, drivers: rows }];
  return (Object.keys(SHIFT_LEASE_NAMES) as ShiftLeaseMode[])
    .map(mode => ({ mode, drivers: rows.filter(driver => shiftLeaseMode(index, driver.id, date) === mode) }))
    .filter(group => group.drivers.length > 0);
}
