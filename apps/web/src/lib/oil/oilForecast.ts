// ============================================================
// 「この予定どおりに走ると、いつオイル交換の距離に届くか」を出す（純粋ロジック）。
//
// 既にある警告（プレート右上の丸）は「いま残りが少ない」という**事実**。
// こちらは「この日に届く見込み」という**予測**で、意味が違うので出し方も分ける
// （塗りつぶしの丸に対して、破線の印をその日のセルに1回だけ・2026-09-10 ユーザー合意）。
//
// 予定が入っている範囲だけを見る。先の見えない期間へは伸ばさない（同上）。
// コースごとの1日あたり走行距離は実績（日報のメーター差）の中央値を使う。
// 実データではコースで 52〜164 km/日 と3倍の開きがあり、全車平均だと大きく外れる。
// ============================================================

export type OilForecastShift = {
  /** "YYYY-MM-DD" */
  date: string;
  courseId: string | null;
};

export type OilForecastInput = {
  /** 次の交換まであと何km（前回交換 + 交換間隔 − 現在の走行距離） */
  remainingKm: number;
  /** その車のこれからの予定（順不同でよい） */
  shifts: readonly OilForecastShift[];
  /** コースごとの1日あたり走行距離（実績の中央値） */
  courseKmPerDay: Readonly<Record<string, number>>;
  /** コースの実績が足りないときに使う、その車の1日あたり走行距離 */
  fallbackKmPerDay: number;
};

export type OilForecast = {
  /** 届く見込みの日 "YYYY-MM-DD" */
  date: string;
  /** その日までに何稼働日か（1 = 次の稼働日） */
  workDays: number;
  /** その日までに走る見込みの距離（km） */
  km: number;
};

/**
 * 予定を日付順に積み、残り距離に届いた最初の日を返す。
 * 予定の範囲で届かなければ null（＝何も出さない）。
 * 既に残りが 0 以下の車は「予測」ではなく既存の警告の領分なので null を返す。
 */
export function forecastOilChange({
  remainingKm,
  shifts,
  courseKmPerDay,
  fallbackKmPerDay,
}: OilForecastInput): OilForecast | null {
  if (!Number.isFinite(remainingKm) || remainingKm <= 0) return null;
  if (shifts.length === 0) return null;

  // 同じ日に複数の便へ入ることがある。日ごとにまとめて、その日の走行距離を足す
  const byDate = new Map<string, number>();
  for (const shift of shifts) {
    const km = (shift.courseId ? courseKmPerDay[shift.courseId] : undefined) ?? fallbackKmPerDay;
    if (!Number.isFinite(km) || km <= 0) continue;
    byDate.set(shift.date, (byDate.get(shift.date) ?? 0) + km);
  }

  let total = 0;
  let workDays = 0;
  for (const date of [...byDate.keys()].sort()) {
    total += byDate.get(date)!;
    workDays += 1;
    if (total >= remainingKm) return { date, workDays, km: Math.round(total) };
  }
  return null;
}

/** 次の交換まであと何km。設定が無い車・EV は null */
export function remainingOilKm(vehicle: {
  is_ev?: boolean | null;
  current_mileage?: number | null;
  last_oil_change_mileage?: number | null;
  oil_change_interval?: number | null;
}): number | null {
  if (vehicle.is_ev) return null;
  const interval = vehicle.oil_change_interval ?? 0;
  if (interval <= 0) return null;
  if (typeof vehicle.current_mileage !== "number") return null;
  return (vehicle.last_oil_change_mileage ?? 0) + interval - vehicle.current_mileage;
}

/**
 * 車両ごとの予測をまとめて出す。
 * 返すのは「印を出す日」だけなので、画面側は日付とプレートで引ける。
 */
export function forecastOilChangesByVehicle(params: {
  vehicles: readonly {
    id: string;
    is_ev?: boolean | null;
    current_mileage?: number | null;
    last_oil_change_mileage?: number | null;
    oil_change_interval?: number | null;
  }[];
  /** これからの予定（車両が決まっているものだけでよい） */
  shifts: readonly { date: string; courseId: string | null; vehicleId: string | null }[];
  courseKmPerDay: Readonly<Record<string, number>>;
  vehicleKmPerDay: Readonly<Record<string, number>>;
  /** どの車の実績も足りないときの最後の頼り */
  fleetKmPerDay: number;
}): Map<string, OilForecast> {
  const byVehicle = new Map<string, OilForecastShift[]>();
  for (const shift of params.shifts) {
    if (!shift.vehicleId) continue;
    (byVehicle.get(shift.vehicleId) ?? byVehicle.set(shift.vehicleId, []).get(shift.vehicleId)!).push({
      date: shift.date,
      courseId: shift.courseId,
    });
  }

  const result = new Map<string, OilForecast>();
  for (const vehicle of params.vehicles) {
    const remainingKm = remainingOilKm(vehicle);
    if (remainingKm == null) continue;
    const shifts = byVehicle.get(vehicle.id);
    if (!shifts?.length) continue;
    const forecast = forecastOilChange({
      remainingKm,
      shifts,
      courseKmPerDay: params.courseKmPerDay,
      fallbackKmPerDay: params.vehicleKmPerDay[vehicle.id] ?? params.fleetKmPerDay,
    });
    if (forecast) result.set(vehicle.id, forecast);
  }
  return result;
}
