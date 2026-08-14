import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/server/aggregation/pagination";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";
import { countOilAlertVehicles, type OilVehicle } from "@repo/core/logic/oilChange";
import { countLicenseAlertDrivers, type LicenseDriver } from "@repo/core/logic/license";

// ============================================================
// 管理バッジの件数集計。/api/admin/badges（統合エンドポイント）と
// 各既存カウントAPI（互換維持）の両方から使う単一の実装。
// ============================================================

/**
 * 日報の要対応件数。RPC（migration 132・COUNT を DB 側で実行）を優先し、
 * 未適用環境では従来のアプリ側走査へフォールバックする。
 * ★判定条件は 132_admin_daily_unread_count.sql と完全に揃えること（変更時は両方を修正）。
 */
export async function countDailyUnread(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("admin_daily_unread_count", {
      p_org: orgId,
      p_start: start,
      p_end: end,
    });
    if (!error && data != null && Number.isFinite(Number(data))) return Number(data);
  } catch {
    // migration 132 未適用（関数なし）など。従来経路で数える
  }
  return countDailyUnreadAppSide(supabase, orgId, start, end);
}

/** アプリ側走査版（RPC フォールバック）。旧 /api/admin/daily/unread-count の実装を移設。 */
export async function countDailyUnreadAppSide(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
): Promise<number> {
  const { data: drivers, error: driversErr } = await supabase
    .from("drivers")
    .select("id")
    .eq("org_id", orgId)
    .eq("works_as_driver", true);
  if (driversErr) throw driversErr;

  // PostgREST の既定上限(1000行)で黙って切られると要対応を数え漏らすため必ずページングする。
  const shiftRows = await fetchAllRows<{
    shift_date: string;
    driver_id: string;
    course_id: string | null;
  }>((from, to) =>
    supabase
      .from("shifts")
      .select("shift_date, driver_id, course_id")
      .gte("shift_date", start)
      .lte("shift_date", end)
      .not("driver_id", "is", null)
      .order("shift_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  // バッジの数字を出すだけなので実績値（report_entries）は不要。
  const reportRows = await loadLegacyDailyRows(supabase, orgId, { start, end }, { withEntries: false });

  const shiftsByDate = new Map<string, Set<string>>();
  // 日付×ドライバーの担当コース集合（1日複数コースの部分未提出を検出するため）
  const shiftCoursesByDate = new Map<string, Map<string, Set<string>>>();
  (shiftRows ?? []).forEach((r) => {
    if (!r.shift_date || !r.driver_id) return;
    if (!shiftsByDate.has(r.shift_date)) shiftsByDate.set(r.shift_date, new Set());
    shiftsByDate.get(r.shift_date)!.add(r.driver_id);
    if (!r.course_id) return;
    if (!shiftCoursesByDate.has(r.shift_date)) shiftCoursesByDate.set(r.shift_date, new Map());
    const byDriver = shiftCoursesByDate.get(r.shift_date)!;
    if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, new Set());
    byDriver.get(r.driver_id)!.add(r.course_id);
  });

  // ドライバーごとに非却下レポートを配列で保持（コース単位の未提出/未承認判定用）
  const reportsByDateDriver = new Map<
    string,
    Map<string, { course_id: string | null; approved_at: string | null }[]>
  >();
  (reportRows ?? []).forEach((r) => {
    if (!r.report_date || !r.driver_id) return;
    if (r.rejected_at) return; // 却下は未提出扱い
    if (!reportsByDateDriver.has(r.report_date)) reportsByDateDriver.set(r.report_date, new Map());
    const byDriver = reportsByDateDriver.get(r.report_date)!;
    const arr = byDriver.get(r.driver_id) ?? [];
    arr.push({ course_id: r.course_id ?? null, approved_at: r.approved_at ?? null });
    byDriver.set(r.driver_id, arr);
  });

  const driverIds = (drivers ?? []).map((d: { id: string }) => d.id);
  const dates: string[] = [];
  const d = new Date(start);
  const endDate = new Date(end);
  while (d <= endDate) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  let unreadCount = 0;
  for (const date of dates) {
    const shifted = shiftsByDate.get(date);
    if (!shifted) continue;
    const reports = reportsByDateDriver.get(date);
    const shiftCourses = shiftCoursesByDate.get(date);
    for (const driverId of driverIds) {
      if (!shifted.has(driverId)) continue;
      const reps = reports?.get(driverId) ?? [];
      if (reps.length === 0) {
        unreadCount += 1; // 日報未提出
        continue;
      }
      const reportedCourses = new Set(reps.map((r) => r.course_id).filter((c): c is string => !!c));
      const courses = shiftCourses?.get(driverId);
      const missing = courses ? Array.from(courses).filter((c) => !reportedCourses.has(c)).length : 0;
      const hasUnapproved = reps.some((r) => !r.approved_at);
      if (missing > 0 || hasUnapproved) {
        unreadCount += 1; // 一部コース未提出 または 未承認
      }
    }
  }
  return unreadCount;
}

/** その他報告（オイル交換申請）の未承認件数。 */
export async function countOilChangeUnread(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("oil_change_reports")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("approved_at", null)
    .is("rejected_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** オイル交換が迫っている（接近 or 要交換）車両の台数。しきい値は core/logic/oilChange。 */
export async function countOilAlert(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("current_mileage, last_oil_change_mileage, oil_change_interval, is_ev")
    .eq("owner_org_id", orgId)
    .eq("is_disposed", false);
  if (error) throw error;
  return countOilAlertVehicles((data ?? []) as OilVehicle[]);
}

/** 免許更新が迫っている（接近 or 期限切れ）在籍ドライバーの人数。しきい値は core/logic/license。 */
export async function countLicenseAlert(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await supabase
    .from("drivers")
    .select("license_expiry_date")
    .eq("org_id", orgId)
    .eq("works_as_driver", true)
    // 稼働終了・却下・承認待ちの人に免許更新を促しても意味がないため、在籍中（active）だけ数える。
    .eq("status", "active");
  if (error) throw error;
  return countLicenseAlertDrivers((data ?? []) as LicenseDriver[]);
}

/** 参加承認待ち（status='pending'）の申請件数。 */
export async function countPendingDrivers(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("works_as_driver", true)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}
