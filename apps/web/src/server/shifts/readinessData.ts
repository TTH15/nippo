// ============================================================
// 未解決一覧のためのデータ読み出し。判定そのものは readiness.ts（純粋関数）に置く。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// migration 168 が未適用の環境でも正式シフト画面を止めないため、
// 新しい表が読めないときは unavailable を返して一覧だけを畳む。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
import {
  collectUnresolved,
  type CourseFrame,
  type DriverPlan,
  type PlanConfirmation,
  type ShiftAssignment,
  type SourceExtract,
  type StaffingBaseline,
  type StaffingRequirement,
  type UnresolvedItem,
} from "./readiness";
import { effectiveTime, planVersionOf, type PlanAssignment } from "./planVersion";
import {
  DEFAULT_READINESS_SETTINGS,
  settingsFromRow,
  type ReadinessSettings,
} from "./readinessSettings";

/**
 * 何日先まで見るかの既定値。会社ごとの設定（shift_readiness_settings）があればそちらが優先。
 * 前日夜が最初の照合にならないよう、既定は2週間先まで出す。
 */
export const READINESS_HORIZON_DAYS = DEFAULT_READINESS_SETTINGS.horizonDays;

/**
 * 会社の解消期限・先読みの設定を読む。
 * 表が無い（migration 171 未適用）・行が無い会社は既定値で動かす。
 */
export async function loadReadinessSettings(db: SupabaseClient, orgId: string): Promise<ReadinessSettings> {
  const { data, error } = await db
    .from("shift_readiness_settings")
    .select("staffing_due_days, confirmation_due_days, dispatch_due_days, horizon_days")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return DEFAULT_READINESS_SETTINGS;
  return settingsFromRow(data as Record<string, unknown> | null);
}

type CycleRow = {
  cycle_no: number;
  label: string | null;
  meeting_place: string | null;
  meeting_time: string | null;
  arrival_time: string | null;
  end_time: string | null;
  active: boolean | null;
};

type CourseRow = {
  id: string;
  name: string | null;
  uses_cycles: boolean | null;
  archived_at: string | null;
  meeting_place: string | null;
  meeting_time: string | null;
  arrival_time: string | null;
  end_time: string | null;
  course_cycles: CycleRow[] | null;
};

type ShiftRow = {
  shift_date: string;
  course_id: string;
  cycle_no: number | null;
  driver_id: string | null;
  vehicle_id: string | null;
  uses_external_vehicle: boolean | null;
  meeting_place: string | null;
  meeting_time: string | null;
  arrival_time: string | null;
  end_time: string | null;
};

export type ReadinessResult = {
  items: UnresolvedItem[];
  /** 表示用の名前。API の応答を薄くするために id → 名前だけ返す */
  courseNames: Record<string, string>;
  cycleLabels: Record<string, string>;
  driverNames: Record<string, string>;
  dates: string[];
  unavailable: boolean;
};

/** 期間の日付を昇順で作る（両端を含む） */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return dates;
  while (cursor <= last && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** コース×便を「会社が動かす枠」に展開する。便を使わないコースは cycleNo=0 の1枠 */
export function framesOf(courses: readonly CourseRow[]): CourseFrame[] {
  const frames: CourseFrame[] = [];
  for (const course of courses) {
    if (course.archived_at) continue;
    const name = course.name ?? "";
    const cycles = (course.course_cycles ?? []).filter((c) => c.active !== false);
    if (course.uses_cycles && cycles.length > 0) {
      for (const cycle of cycles) {
        frames.push({ courseId: course.id, courseName: name, cycleNo: cycle.cycle_no, cycleLabel: cycle.label ?? null });
      }
    } else {
      frames.push({ courseId: course.id, courseName: name, cycleNo: 0, cycleLabel: null });
    }
  }
  return frames;
}

/**
 * 本人ごとの「その日の予定の版」を作る。時刻は shifts → 便 → コース の順に解決する
 * （migration 106 / 136 の約束）。
 */
export function driverPlansOf(shifts: readonly ShiftRow[], courses: readonly CourseRow[]): DriverPlan[] {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const byDriverDate = new Map<string, PlanAssignment[]>();
  for (const shift of shifts) {
    if (!shift.driver_id) continue;
    const course = courseById.get(shift.course_id);
    const cycleNo = shift.cycle_no ?? 0;
    const cycle = (course?.course_cycles ?? []).find((c) => c.cycle_no === cycleNo);
    const assignment: PlanAssignment = {
      courseId: shift.course_id,
      cycleNo,
      meetingPlace: effectiveTime(shift.meeting_place, cycle?.meeting_place, course?.meeting_place),
      meetingTime: effectiveTime(shift.meeting_time, cycle?.meeting_time, course?.meeting_time),
      arrivalTime: effectiveTime(shift.arrival_time, cycle?.arrival_time, course?.arrival_time),
      endTime: effectiveTime(shift.end_time, cycle?.end_time, course?.end_time),
    };
    const key = `${shift.driver_id}|${shift.shift_date}`;
    const list = byDriverDate.get(key);
    if (list) list.push(assignment);
    else byDriverDate.set(key, [assignment]);
  }
  return [...byDriverDate.entries()].map(([key, assignments]) => {
    const [driverId, date] = key.split("|");
    return { driverId, date, planVersion: planVersionOf(date, assignments) };
  });
}

/** 取り込みバッチに残した抽出結果を照合用の形にそろえる。読めない形は捨てる */
export function sourceExtractsOf(batches: readonly { extracted: unknown }[]): SourceExtract[] {
  const extracts: SourceExtract[] = [];
  for (const batch of batches) {
    const rows = (batch.extracted as { rows?: unknown } | null)?.rows;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const { date, courseId, cycleNo, driverIds } = row as Record<string, unknown>;
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (typeof courseId !== "string" || !courseId) continue;
      if (!Array.isArray(driverIds)) continue;
      extracts.push({
        date,
        courseId,
        cycleNo: typeof cycleNo === "number" && Number.isInteger(cycleNo) && cycleNo >= 0 ? cycleNo : 0,
        driverIds: driverIds.filter((id): id is string => typeof id === "string" && !!id),
      });
    }
  }
  return extracts;
}

/**
 * 期間の未解決一覧を作る。start/end は呼び出し側で当日以降に丸めておくこと
 * （過去日は「事前に気づく」対象ではない）。
 */
export async function loadReadiness(
  db: SupabaseClient,
  ctx: { orgId: string; start: string; end: string; settings?: ReadinessSettings },
): Promise<ReadinessResult> {
  const dates = datesBetween(ctx.start, ctx.end);
  const empty: ReadinessResult = { items: [], courseNames: {}, cycleLabels: {}, driverNames: {}, dates, unavailable: false };
  if (dates.length === 0) return empty;

  // ★マスターも 1000 行で切り詰められる。drivers が欠けると、その人の配置が
  //   「他社参照の壊れた行」として捨てられ、実在しない不足が赤で出る（2026-08-03 の教訓）
  let courses: CourseRow[];
  let drivers: { id: string; name: string | null; display_name: string | null }[];
  try {
    [courses, drivers] = await Promise.all([
      fetchAllRows<CourseRow>((from, to) =>
        db
          .from("courses")
          .select("id, name, uses_cycles, archived_at, meeting_place, meeting_time, arrival_time, end_time, course_cycles(cycle_no, label, meeting_place, meeting_time, arrival_time, end_time, active)")
          .eq("org_id", ctx.orgId)
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<{ id: string; name: string | null; display_name: string | null }>((from, to) =>
        db.from("drivers").select("id, name, display_name").eq("org_id", ctx.orgId).order("id").range(from, to),
      ),
    ]);
  } catch (error) {
    console.error("[shift readiness] master load error", error);
    return { ...empty, unavailable: true };
  }
  const courseIds = courses.map((c) => c.id);
  const driverIds = new Set(drivers.map((d) => d.id));
  if (courseIds.length === 0) return empty;

  // 14日×人数ぶんの行は 1000 行を超える。ORDER BY 無しの切り詰めは
  // 「配置がゼロの日」を作り、実在しない不足を赤で出してしまう（2026-08-03 の教訓）
  let shifts: ShiftRow[];
  try {
    const pages: ShiftRow[][] = [];
    for (let i = 0; i < courseIds.length; i += IN_CLAUSE_BATCH_SIZE) {
      const batch = courseIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
      pages.push(
        await fetchAllRows<ShiftRow>((from, to) =>
          db
            // tenant-scope-ok: courseIds は自社の courses（.eq("org_id", orgId)）から作った集合
            .from("shifts")
            .select("id, shift_date, course_id, cycle_no, driver_id, vehicle_id, uses_external_vehicle, meeting_place, meeting_time, arrival_time, end_time")
            .in("course_id", batch)
            .gte("shift_date", ctx.start)
            .lte("shift_date", ctx.end)
            .order("shift_date")
            .order("id")
            .range(from, to),
        ),
      );
    }
    // 他社のドライバーを指す壊れた行は判定にも表示にも持ち込まない（165 と同じ扱い）
    shifts = pages.flat().filter((s) => !s.driver_id || driverIds.has(s.driver_id));
  } catch (error) {
    console.error("[shift readiness] shifts load error", error);
    return { ...empty, unavailable: true };
  }

  // migration 168 が未適用ならここで落ちる。画面は止めず「準備中」にする
  let requirementResult: { data: Record<string, unknown>[]; error: null };
  let baselineResult: { data: Record<string, unknown>[]; error: null };
  let confirmationResult: { data: Record<string, unknown>[]; error: null };
  let batchRows: { extracted: unknown }[] = [];
  try {
    const [requirements, baselines, confirmations] = await Promise.all([
      fetchAllRows<Record<string, unknown>>((from, to) =>
        db.from("shift_staffing_requirements").select("id, shift_date, course_id, cycle_no, state, required_count")
          .eq("org_id", ctx.orgId).gte("shift_date", ctx.start).lte("shift_date", ctx.end)
          .order("shift_date").order("id").range(from, to)),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        db.from("shift_staffing_baselines").select("id, course_id, cycle_no, weekday, state, required_count")
          .eq("org_id", ctx.orgId).order("id").range(from, to)),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        db.from("shift_plan_confirmations").select("id, driver_id, shift_date, plan_version, response")
          .eq("org_id", ctx.orgId).gte("shift_date", ctx.start).lte("shift_date", ctx.end)
          .order("shift_date").order("id").range(from, to)),
    ]);
    requirementResult = { data: requirements, error: null };
    baselineResult = { data: baselines, error: null };
    confirmationResult = { data: confirmations, error: null };
  } catch (error) {
    console.error("[shift readiness] readiness tables unavailable", error);
    return { ...empty, unavailable: true };
  }
  // 原本の抽出結果。取り消し済みは除き、対象期間に重なるバッチだけを見る
  // （件数で打ち切ると、古い取り込みの照合が静かに止まる）
  {
    const { data, error } = await db
      .from("shift_import_batches")
      .select("extracted")
      .eq("org_id", ctx.orgId)
      .is("reverted_at", null)
      .not("extracted", "is", null)
      .gte("covers_end", ctx.start)
      .lte("covers_start", ctx.end)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(200);
    if (!error) batchRows = (data ?? []) as { extracted: unknown }[];
  }

  const requirements: StaffingRequirement[] = (requirementResult.data ?? []).map((r) => ({
    date: r.shift_date as string,
    courseId: r.course_id as string,
    cycleNo: (r.cycle_no as number) ?? 0,
    state: r.state as StaffingRequirement["state"],
    requiredCount: (r.required_count as number | null) ?? null,
  }));
  const baselines: StaffingBaseline[] = (baselineResult.data ?? []).map((b) => ({
    courseId: b.course_id as string,
    cycleNo: (b.cycle_no as number) ?? 0,
    weekday: b.weekday as number,
    state: b.state as StaffingBaseline["state"],
    requiredCount: (b.required_count as number | null) ?? null,
  }));
  const confirmations: PlanConfirmation[] = (confirmationResult.data ?? [])
    .filter((c) => driverIds.has(c.driver_id as string))
    .map((c) => ({
      driverId: c.driver_id as string,
      date: c.shift_date as string,
      planVersion: c.plan_version as string,
      response: c.response as PlanConfirmation["response"],
    }));

  const assignments: ShiftAssignment[] = shifts.map((s) => ({
    date: s.shift_date,
    courseId: s.course_id,
    cycleNo: s.cycle_no ?? 0,
    driverId: s.driver_id,
    vehicleId: s.vehicle_id,
    usesExternalVehicle: s.uses_external_vehicle === true,
  }));

  const frames = framesOf(courses);
  // 原本の抽出結果は自社のコース・ドライバーに限る（取り込み時点の他社参照を照合へ持ち込まない）
  const courseSet = new Set(courseIds);
  const sourceExtracts = sourceExtractsOf(batchRows)
    .filter((e) => courseSet.has(e.courseId))
    .map((e) => ({ ...e, driverIds: e.driverIds.filter((id) => driverIds.has(id)) }));

  const items = collectUnresolved({
    dates,
    frames,
    baselines,
    requirements,
    assignments,
    confirmations,
    plans: driverPlansOf(shifts, courses),
    sourceExtracts,
    settings: ctx.settings,
  });

  const usedCourses = new Set(items.map((i) => i.courseId).filter((id): id is string => !!id));
  const usedDrivers = new Set(items.map((i) => i.driverId).filter((id): id is string => !!id));
  return {
    items,
    courseNames: Object.fromEntries(frames.filter((f) => usedCourses.has(f.courseId)).map((f) => [f.courseId, f.courseName])),
    cycleLabels: Object.fromEntries(
      frames.filter((f) => usedCourses.has(f.courseId) && f.cycleLabel).map((f) => [`${f.courseId}|${f.cycleNo}`, f.cycleLabel as string]),
    ),
    driverNames: Object.fromEntries(
      drivers.filter((d) => usedDrivers.has(d.id)).map((d) => [d.id, d.display_name || d.name || ""]),
    ),
    dates,
    unavailable: false,
  };
}
