// シフト表の日ごとの車両過不足と、同一車両の重複割り当ての判定（純粋ロジック）。
// 画面（admin/(ops)/shifts）は日付ごとにこれを呼び、稼働人数の下に表示する。

export type VehicleBalance = {
  /** その日に使える車両数（廃車・一時使用不可・貸出中を除く） */
  usable: number;
  /** その日に必要な台数 = 割り当て済みの車の台数（同じ車を2人で回す分は1台）＋ 車未割当で他社車両でもない稼働人数 */
  demand: number;
  /** 余り（正）／不足（負） */
  surplus: number;
};

export function computeVehicleBalance(input: {
  fleet: { id: string; is_disposed?: boolean | null; is_unavailable?: boolean | null }[];
  loanedIds?: Set<string> | null;
  workingDriverIds: Iterable<string>;
  /** その日そのドライバーに割り当てた車両 id。未割当は null */
  vehicleOf?: (driverId: string) => string | null | undefined;
  isExternal?: (driverId: string) => boolean;
}): VehicleBalance {
  const usable = input.fleet.filter((v) => !v.is_disposed && !v.is_unavailable && !(input.loanedIds?.has(v.id) ?? false)).length;
  const assignedVehicles = new Set<string>();
  let unassigned = 0;
  for (const id of input.workingDriverIds) {
    const vehicleId = input.vehicleOf?.(id);
    if (vehicleId) assignedVehicles.add(vehicleId);
    else if (!input.isExternal?.(id)) unassigned += 1;
  }
  const demand = assignedVehicles.size + unassigned;
  return { usable, demand, surplus: usable - demand };
}

/** 現場で読む短い表現。「車 余り2台」「車 不足1台」「車 ちょうど」 */
export function formatVehicleBalance(balance: Pick<VehicleBalance, "surplus">): string {
  if (balance.surplus > 0) return `車 余り${balance.surplus}台`;
  if (balance.surplus < 0) return `車 不足${-balance.surplus}台`;
  return "車 ちょうど";
}

/** 2人以上に割り当てられている車両 id */
export function duplicateVehicleIds(holders: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const [vehicleId, driverIds] of holders) if (new Set(driverIds).size > 1) out.add(vehicleId);
  return out;
}
