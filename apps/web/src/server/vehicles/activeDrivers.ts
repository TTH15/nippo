// ============================================================
// 車両の利用ドライバーを「稼働中」だけに絞る。
//
// vehicle_drivers には退職・稼働終了後の紐付けが残る。素の join だと
// 一覧にだけ退職者が出て、編集モーダル（稼働中のみが候補）と食い違い、
// 「選んでいない人が表示される」「外せない」状態になる。
// 判定条件は /api/admin/users（works_as_driver=true かつ status='active'）と揃える。
// ============================================================

export type VehicleDriverRow = {
  driver_id: string;
  drivers?: { works_as_driver?: boolean | null; status?: string | null } | null;
};

/** その紐付けが「今も稼働しているドライバー」か。 */
export function isActiveVehicleDriver(row: VehicleDriverRow): boolean {
  return row.drivers?.works_as_driver === true && row.drivers?.status === "active";
}

export function filterActiveVehicleDrivers(rows: VehicleDriverRow[] | null | undefined): VehicleDriverRow[] {
  return (rows ?? []).filter(isActiveVehicleDriver);
}
