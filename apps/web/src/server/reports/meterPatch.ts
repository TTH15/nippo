// 未指定は別経路の写真解析値を維持。旧Webの数値指定・明示nullは従来どおり扱う。
export function reportMeterPatch(item: { meterValue?: number | null; vehicleId?: string | null }, previousVehicleId?: string | null): { meter_value?: number | null } {
  if (Object.prototype.hasOwnProperty.call(item, "meterValue")) {
    return { meter_value: typeof item.meterValue === "number" ? item.meterValue : null };
  }
  // 車両を訂正した日報に、変更前の車両のメーターを引き継がない。
  return previousVehicleId !== undefined && previousVehicleId !== (item.vehicleId ?? null)
    ? { meter_value: null }
    : {};
}
