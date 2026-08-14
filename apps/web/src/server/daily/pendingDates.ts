import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/server/aggregation/pagination";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

// ============================================================
// 日報「要対応」ビューの対象日を確定する。
// RPC（migration 133・DB 側で日付だけを返す）を優先し、未適用環境では
// 従来のアプリ側走査（shifts 全件+日報ヘッダ全件）へフォールバックする。
// ★判定条件は 133_admin_daily_pending_dates.sql と完全に揃えること（変更時は両方を修正）。
// ============================================================

export async function loadPendingDates(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("admin_daily_pending_dates", {
      p_org: orgId,
      p_start: start,
      p_end: end,
    });
    if (!error && Array.isArray(data)) {
      return data
        .map((d) => String(typeof d === "object" && d !== null ? Object.values(d)[0] : d).slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    }
  } catch {
    // migration 133 未適用（関数なし）など。従来経路で確定する
  }
  return loadPendingDatesAppSide(supabase, orgId, start, end);
}

/** アプリ側走査版（RPC フォールバック）。日報は entries なしのヘッダだけ読む。 */
export async function loadPendingDatesAppSide(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
): Promise<string[]> {
  const { data: drivers, error: driversErr } = await supabase
    .from("drivers")
    .select("id")
    .eq("org_id", orgId)
    .eq("works_as_driver", true);
  if (driversErr) throw driversErr;
  const orgDriverIds = new Set((drivers ?? []).map((d: { id: string }) => d.id));

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

  const reportRows = await loadLegacyDailyRows(supabase, orgId, { start, end }, { withEntries: false });

  // シフト: org ドライバーのものだけを判定に使う（他社シフトで日が立たないように）
  const shiftsByDate = new Map<string, Set<string>>();
  const shiftCoursesByDate = new Map<string, Map<string, Set<string>>>();
  shiftRows.forEach((r) => {
    if (!r.shift_date || !r.driver_id || !orgDriverIds.has(r.driver_id)) return;
    if (!shiftsByDate.has(r.shift_date)) shiftsByDate.set(r.shift_date, new Set());
    shiftsByDate.get(r.shift_date)!.add(r.driver_id);
    if (!r.course_id) return;
    if (!shiftCoursesByDate.has(r.shift_date)) shiftCoursesByDate.set(r.shift_date, new Map());
    const byDriver = shiftCoursesByDate.get(r.shift_date)!;
    if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, new Set());
    byDriver.get(r.driver_id)!.add(r.course_id);
  });

  // 非却下の日報: 日付×ドライバーの提出コース集合と未承認有無
  const submitted = new Map<string, Map<string, { courses: Set<string>; hasUnapproved: boolean }>>();
  reportRows.forEach((r) => {
    if (!r.report_date || !r.driver_id || r.rejected_at) return;
    if (!submitted.has(r.report_date)) submitted.set(r.report_date, new Map());
    const byDriver = submitted.get(r.report_date)!;
    const cur = byDriver.get(r.driver_id) ?? { courses: new Set<string>(), hasUnapproved: false };
    if (r.course_id) cur.courses.add(r.course_id);
    if (!r.approved_at) cur.hasUnapproved = true;
    byDriver.set(r.driver_id, cur);
  });

  const hasPendingOn = (date: string): boolean => {
    const byDriver = submitted.get(date);
    if (byDriver) {
      for (const v of byDriver.values()) if (v.hasUnapproved) return true;
    }
    const coursesByDriver = shiftCoursesByDate.get(date);
    for (const driverId of shiftsByDate.get(date) ?? []) {
      const rec = byDriver?.get(driverId);
      if (!rec) return true; // シフトがあるのに日報ゼロ
      const cs = coursesByDriver?.get(driverId);
      if (cs && Array.from(cs).some((c) => !rec.courses.has(c))) return true; // 一部コース未提出
    }
    return false;
  };

  const candidates = new Set<string>();
  shiftsByDate.forEach((_v, date) => candidates.add(date));
  submitted.forEach((_v, date) => candidates.add(date));
  return Array.from(candidates).filter(hasPendingOn).sort();
}
