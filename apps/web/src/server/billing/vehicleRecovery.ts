import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCourseDailyLease } from "@/server/billing/driverLease";
import { fetchAllRows } from "@/server/aggregation/pagination";

// ============================================================
// 車両の初期費用回収（v2）。
//   回収額 = 繰越(recovery_carryover)
//          + Σ 自動カレンダー月回収 [recovery_start_month..当月]: max(lease_cost + 日額自動 − 保険料, 0)
//          + Σ 手動行(vehicle_recovery_entries): max(lease − insurance, 0)
// 日額自動 = 承認 daily_reports_v2 で driver が DAILY リース・vehicle_id=該当車両 の
//            その月の Σ courses.daily_lease。
// 旧 vehicle_recovery_collected（チェックボックス）は使わない（繰越に移行済み）。
// ============================================================

export type RecoveryMonth = {
  ym: string; // YYYY-MM-01
  baseLease: number;
  dailyAuto: number;
  insurance: number;
  monthlyRecovery: number;
  cumulative: number;
  kind: "carryover" | "auto" | "manual";
  entryId?: string; // manual のみ
  note?: string | null;
};

export type VehicleRecovery = {
  vehicleId: string;
  purchaseCost: number;
  carryover: number;
  baseLease: number;
  insurance: number;
  startMonth: string; // YYYY-MM-01
  months: RecoveryMonth[];
  recovered: number;
  remaining: number;
};

function ymOf(dateStr: string): string {
  return `${String(dateStr).slice(0, 7)}-01`;
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

type LeaseRow = { driver_id: string; mode: string | null; valid_from: string | null; valid_to: string | null };

function isDailyLeaseActiveOn(rows: LeaseRow[], date: string): boolean {
  return rows.some(
    (r) =>
      r.mode === "DAILY" &&
      (!r.valid_from || r.valid_from <= date) &&
      (!r.valid_to || r.valid_to >= date),
  );
}

/**
 * 日額リース自動計上を車両×月で集計: Map<vehicleId, Map<ym, number>>。
 * vehicleIds 指定で絞り込み（詳細用）、未指定で全車両（一覧用）。
 * 未指定時は日付・車両でしか絞られないため、orgId で必ずテナントを限定する。
 */
export async function loadDailyLeaseByVehicleMonth(
  supabase: SupabaseClient,
  orgId: string,
  vehicleIds?: string[],
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();

  // まず DB 側の集計関数（migration 131）を使う。日報全履歴の転送（件数比例で悪化）を
  // 「車両×月」の数十行に置き換える。関数が未適用の環境ではエラーになるので、
  // その場合は従来のアプリ側走査へフォールバックする（結果は同一になるよう条件を揃えてある）。
  // 集計結果も db-max-rows（1000行）で切り詰められうるため range ページングを通す。
  try {
    const aggRows = await fetchAllRows<{ vehicle_id: string; ym: string; amount: number }>(
      (from, to) =>
        supabase
          .rpc("vehicle_daily_lease_agg", {
            p_org_id: orgId,
            p_vehicle_ids: vehicleIds && vehicleIds.length > 0 ? vehicleIds : null,
          })
          .order("vehicle_id")
          .order("ym")
          .range(from, to),
    );
    for (const r of aggRows) {
      const ym = ymOf(String(r.ym));
      const perVehicle = result.get(r.vehicle_id) ?? new Map<string, number>();
      perVehicle.set(ym, (perVehicle.get(ym) ?? 0) + (Number(r.amount) || 0));
      result.set(r.vehicle_id, perVehicle);
    }
    return result;
  } catch {
    // migration 131 未適用（関数なし）など。従来経路で計算する
    result.clear();
  }

  // ★ .limit(100000) は効かない。PostgREST は db-max-rows（既定1000）で
  //   クライアントの limit 指定に関わらず黙って切り詰めるため、
  //   以前は1000件で打ち切られ「エラーにならず金額が過少計上」されていた
  //   （実測: 該当1048件のうち1000件しか読めていなかった）。
  //   range でページングする fetchAllRows を必ず使うこと。
  const reports = await fetchAllRows<{
    report_date: string;
    course_id: string | null;
    vehicle_id: string | null;
    driver_id: string;
  }>((from, to) => {
    let q = supabase
      .from("daily_reports_v2")
      .select("report_date, course_id, vehicle_id, driver_id, approved_at, rejected_at")
      .eq("org_id", orgId)
      .not("vehicle_id", "is", null)
      .not("approved_at", "is", null)
      .is("rejected_at", null);
    if (vehicleIds && vehicleIds.length > 0) q = q.in("vehicle_id", vehicleIds);
    // ページングには一意な並びが必須（無いと行の重複・欠落が起き、金額がズレる）
    return q.order("report_date", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });

  const [{ data: leaseRows }, courseDaily] = await Promise.all([
    // driver_leases は org 列を持たないため driver 経由で絞る（他社の契約を混ぜない）
    supabase
      .from("driver_leases")
      .select("driver_id, mode, valid_from, valid_to, drivers!inner(org_id)")
      .eq("drivers.org_id", orgId),
    loadCourseDailyLease(supabase, orgId),
  ]);

  const leasesByDriver = new Map<string, LeaseRow[]>();
  (leaseRows ?? []).forEach((r: LeaseRow) => {
    const arr = leasesByDriver.get(r.driver_id) ?? [];
    arr.push(r);
    leasesByDriver.set(r.driver_id, arr);
  });

  for (const r of reports ?? []) {
    const row = r as {
      report_date: string;
      course_id: string | null;
      vehicle_id: string | null;
      driver_id: string;
    };
    if (!row.vehicle_id || !row.course_id) continue;
    const driverLeases = leasesByDriver.get(row.driver_id);
    if (!driverLeases || !isDailyLeaseActiveOn(driverLeases, row.report_date)) continue;
    const amount = courseDaily.get(row.course_id) ?? 0;
    if (amount <= 0) continue;
    const ym = ymOf(row.report_date);
    const perVehicle = result.get(row.vehicle_id) ?? new Map<string, number>();
    perVehicle.set(ym, (perVehicle.get(ym) ?? 0) + amount);
    result.set(row.vehicle_id, perVehicle);
  }

  return result;
}

type VehicleLite = {
  id: string;
  purchase_cost?: number | null;
  lease_cost?: number | null;
  monthly_insurance?: number | null;
  recovery_start_month?: string | null;
  recovery_carryover?: number | null;
};

type ManualRow = { id: string; vehicle_id: string; ym: string; lease: number; insurance: number; note: string | null };

const DEFAULT_LEASE_COST = 35000;

/**
 * 1 車両の回収内訳を構築（純粋）。nowYm=当月(YYYY-MM-01)。
 */
export function buildVehicleRecovery(
  vehicle: VehicleLite,
  dailyByMonth: Map<string, number>,
  manualRows: ManualRow[],
  nowYm: string,
): VehicleRecovery {
  const baseLease = vehicle.lease_cost ?? DEFAULT_LEASE_COST;
  const insurance = vehicle.monthly_insurance ?? 0;
  const purchaseCost = vehicle.purchase_cost ?? 0;
  const carryover = vehicle.recovery_carryover ?? 0;
  const startMonth = vehicle.recovery_start_month
    ? ymOf(vehicle.recovery_start_month)
    : nowYm;

  const months: RecoveryMonth[] = [];
  let cumulative = 0;

  // 繰越（移行済み回収）
  if (carryover !== 0) {
    cumulative += carryover;
    months.push({
      ym: startMonth,
      baseLease: 0,
      dailyAuto: 0,
      insurance: 0,
      monthlyRecovery: carryover,
      cumulative,
      kind: "carryover",
    });
  }

  // 自動カレンダー月（startMonth..nowYm）。日額自動計上のある未来月も拾うため max(now, 最終日額月)。
  let lastDailyYm = startMonth;
  for (const ym of dailyByMonth.keys()) if (ym > lastDailyYm) lastDailyYm = ym;
  const endYm = nowYm > lastDailyYm ? nowYm : lastDailyYm;

  // startMonth が endYm より後（未来開始）なら自動行なし
  for (let ym = startMonth; ym <= endYm; ym = addMonths(ym, 1)) {
    const dailyAuto = dailyByMonth.get(ym) ?? 0;
    const monthlyRecovery = Math.max(baseLease + dailyAuto - insurance, 0);
    cumulative += monthlyRecovery;
    months.push({
      ym,
      baseLease,
      dailyAuto,
      insurance,
      monthlyRecovery,
      cumulative,
      kind: "auto",
    });
  }

  // 手動行（月順）
  const sortedManual = [...manualRows].sort((a, b) => a.ym.localeCompare(b.ym));
  for (const mr of sortedManual) {
    const monthlyRecovery = Math.max((mr.lease ?? 0) - (mr.insurance ?? 0), 0);
    cumulative += monthlyRecovery;
    months.push({
      ym: ymOf(mr.ym),
      baseLease: mr.lease ?? 0,
      dailyAuto: 0,
      insurance: mr.insurance ?? 0,
      monthlyRecovery,
      cumulative,
      kind: "manual",
      entryId: mr.id,
      note: mr.note,
    });
  }

  const recovered = cumulative;
  return {
    vehicleId: vehicle.id,
    purchaseCost,
    carryover,
    baseLease,
    insurance,
    startMonth,
    months,
    recovered,
    remaining: Math.max(purchaseCost - recovered, 0),
  };
}

/** 当月 YYYY-MM-01 */
export function currentYm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
