import { hasMeaningfulReportValue } from "@/server/reports/courseReportFieldFilter";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isDateOnly } from "@/server/db/adminResourceScope";
import { resolveReportCycleChoices } from "@repo/core/logic/dailyReport";
import { loadCourseReportFields } from "@/server/reports/courseReportFields";

import { POST_SUBMIT_PARKING_POLICY, requiresVehicleReturn } from "@/server/reports/postSubmitParking";

export const dynamic = "force-dynamic";

// ============================================================
// 動的日報フォームのスキーマ＋既存値を返す（新モデル）
//   その日のドライバーのシフト(=コース) ごとに、
//   キャリア配下の unit と unit_fields（報告項目）を返す。
//   既存 daily_reports_v2 + report_entries があれば prefill 用に同梱。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!isDateOnly(date)) return NextResponse.json({ error: "date が必要です" }, { status: 400 });
  const includeCandidates = req.nextUrl.searchParams.get("candidates") === "1";

  const { data: revision, error: revisionError } = await supabase.rpc("report_day_revision", { p_org: orgId, p_driver: user.driverId, p_date: date });
  const { data: requests, error: requestError } = await supabase.from("report_course_requests")
    .select("id,course_id,cycle_no,payload,status,decided_at").eq("org_id", orgId).eq("driver_id", user.driverId).eq("report_date", date).in("status", ["pending", "rejected"]);
  if (revisionError || requestError) return NextResponse.json({ error: "日報を読み込めませんでした" }, { status: 500 });
  const pending = (requests ?? []).filter(q => q.status === "pending");
  // その日のシフト（コース）
  const { data: shiftRows } = await supabase
    // tenant-scope-ok: 認証済みの本人（user.driverId）に固定。org 絞りより狭い
    .from("shifts")
    .select("course_id, cycle_no, slot, vehicle_id")
    .eq("driver_id", user.driverId)
    .eq("shift_date", date)
    .order("slot");

  const rawShiftVehicleId: string | null =
    (shiftRows ?? []).map((s: any) => s.vehicle_id).find((v: string | null) => !!v) ?? null;
  const { data: memberships, error: candidateError } = includeCandidates
    // tenant-scope-ok: 本人の勤務区分に限定し、下の courses 取得で組織を確認する。
    ? await supabase.from("driver_courses").select("course_id,cycle_no,driver_identities!inner(driver_id)")
        .eq("driver_identities.driver_id", user.driverId)
    : { data: [], error: null };
  if (candidateError) return NextResponse.json({ error: "コースを読み込めませんでした" }, { status: 500 });
  const memberCyclesByCourse = new Map<string, Set<number>>();
  for (const row of memberships ?? []) {
    const cycles = memberCyclesByCourse.get(row.course_id) ?? new Set<number>();
    cycles.add(row.cycle_no);
    memberCyclesByCourse.set(row.course_id, cycles);
  }
  const courseIds = Array.from(new Set([...(shiftRows ?? []).map((s: any) => s.course_id).filter(Boolean), ...memberCyclesByCourse.keys(), ...pending.map(q => q.course_id)]));
  const rawShiftChoices = Array.from(
    new Map(
      (shiftRows ?? [])
        .filter((s: any) => s.course_id)
        .map((s: any) => [`${s.course_id}:${Number(s.cycle_no) || 0}`, { courseId: s.course_id, cycleNo: Number(s.cycle_no) || 0 }]),
    ).values(),
  );

  // shifts 以外に依存しない取得は1波にまとめる（旧: 7段直列。日付変更のたび全往復していた）
  const [{ data: shiftVehicle }, { data: courses }, { data: existingReports }, vehicleReturnRequired] = await Promise.all([
    // その日にシフトで割り当てられた車両（先頭の非null）。廃車・一時使用不可は既定から除外
    rawShiftVehicleId
      // tenant-scope-ok: 本人の当日シフトで割当済みの車両。貸与車も含め利用可否の2フラグだけを取得
      ? supabase.from("vehicles").select("is_disposed, is_unavailable").eq("id", rawShiftVehicleId).maybeSingle()
      : Promise.resolve({ data: null as { is_disposed: boolean; is_unavailable: boolean } | null }),
    // コース → キャリア
    courseIds.length
      ? supabase.from("courses").select("id, name, color, summary_title, carrier_id, uses_cycles, archived_at, course_cycles(cycle_no, label, active)").in("id", courseIds).eq("org_id", orgId)
      : Promise.resolve({ data: [] as any[] }),
    // 既存 v2 レポート（prefill）
    courseIds.length
      ? supabase
          .from("daily_reports_v2") // tenant-scope-ok: 本人（user.driverId）の日報のみ＝org をまたがない
          .select("id, course_id, cycle_no, vehicle_id, meter_value, approved_at, rejected_at")
          .eq("driver_id", user.driverId)
          .eq("report_date", date)
          .in("course_id", courseIds)
      : Promise.resolve({ data: [] as any[] }),
    req.nextUrl.searchParams.get("parkingPolicy") === POST_SUBMIT_PARKING_POLICY
      ? requiresVehicleReturn(supabase, user.driverId, date)
      : undefined,
  ]);
  const shiftVehicleId =
    rawShiftVehicleId && !shiftVehicle?.is_disposed && !shiftVehicle?.is_unavailable
      ? rawShiftVehicleId
      : null;

  if (courseIds.length === 0) {
    return NextResponse.json({ shifts: [], candidates: [], shiftVehicleId, vehicleReturnRequired, revision });
  }

  const carrierIds = Array.from(new Set((courses ?? []).map((c: any) => c.carrier_id).filter(Boolean)));
  const reportIds = (existingReports ?? []).map((r: any) => r.id);

  const [{ data: carriers }, { data: units }, { data: existingEntries }] = await Promise.all([
    carrierIds.length ? supabase.from("carriers").select("id, name").in("id", carrierIds) : Promise.resolve({ data: [] as any[] }),
    carrierIds.length
      ? supabase.from("units").select("id, carrier_id, name, code, billing_type, sort_order, active").in("carrier_id", carrierIds).eq("active", true).order("sort_order")
      : Promise.resolve({ data: [] as any[] }),
    reportIds.length
      // tenant-scope-ok: reportIds は本人（user.driverId）の日報から作った集合
      ? supabase.from("report_entries").select("report_id, unit_id, field_key, value_num, value_text").in("report_id", reportIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const unitIds = (units ?? []).map((u: any) => u.id);
  const { data: fieldRows } = unitIds.length
    ? await supabase.from("unit_fields").select("*").in("unit_id", unitIds).order("sort_order")
    : { data: [] as any[] };

  const carrierName = new Map<string, string>((carriers ?? []).map((c: any) => [c.id, c.name]));
  const fieldsByUnit = new Map<string, any[]>();
  (fieldRows ?? []).forEach((f: any) => {
    const arr = fieldsByUnit.get(f.unit_id) ?? [];
    arr.push({
      fieldKey: f.field_key,
      label: f.label,
      inputType: f.input_type,
      groupLabel: f.group_label ?? null,
      required: !!f.required,
      sortOrder: f.sort_order,
    });
    fieldsByUnit.set(f.unit_id, arr);
  });
  // コース（＋便）ごとに使う項目だけを出す。設定が無いコースは全項目のまま。
  const reportFieldFilter = await loadCourseReportFields(supabase, courseIds);
  const unitsFor = (carrierId: string | null, courseId: string, cycleNo: number) =>
    (units ?? [])
      .filter((u: any) => u.carrier_id === carrierId)
      .map((u: any) => ({
        id: u.id,
        name: u.name,
        code: u.code,
        billingType: u.billing_type,
        fields: (fieldsByUnit.get(u.id) ?? []).filter((f: any) =>
          reportFieldFilter.allows(courseId, cycleNo, u.id, f.fieldKey)),
      }))
      .filter((u: any) => u.fields.length > 0);

  const reportByCourseCycle = new Map<string, any>(
    (existingReports ?? []).filter((r: any) => !r.rejected_at).map((r: any) => [`${r.course_id}:${Number(r.cycle_no) || 0}`, r]),
  );
  const shiftChoices = resolveReportCycleChoices(
    rawShiftChoices,
    (existingReports ?? []).filter((report: any) => report.rejected_at == null).map((report: any) => ({
      courseId: String(report.course_id),
      cycleNo: Number(report.cycle_no) || 0,
    })),
  );
  const entriesByReport = new Map<string, Record<string, Record<string, number | string>>>();
  (existingEntries ?? []).forEach((e: any) => {
    const m = entriesByReport.get(e.report_id) ?? {};
    m[e.unit_id] = m[e.unit_id] ?? {};
    m[e.unit_id][e.field_key] = e.value_num != null ? Number(e.value_num) : (e.value_text ?? "");
    entriesByReport.set(e.report_id, m);
  });

  const courseById = new Map<string, any>((courses ?? []).map((c: any) => [c.id, c]));

  const makeShift = ({ courseId, cycleNo }: { courseId: string; cycleNo: number }) => {
    const c = courseById.get(courseId);
    const existing = reportByCourseCycle.get(`${courseId}:${cycleNo}`);
    const cycle = (c?.course_cycles ?? []).find((item: any) => Number(item.cycle_no) === cycleNo);
    return {
      courseId,
      cycleNo,
      cycleLabel: cycle?.label ?? (cycleNo > 0 ? `C${cycleNo}` : null),
      courseName: c?.summary_title?.trim() || c?.name || "",
      color: c?.color ?? null,
      carrierId: c?.carrier_id ?? null,
      carrierName: c?.carrier_id ? carrierName.get(c.carrier_id) ?? "" : "",
      units: c?.carrier_id ? unitsFor(c.carrier_id, courseId, cycleNo) : [],
      existing: existing
        ? {
            requiresReview: (existingEntries ?? []).some((e: any) => e.report_id === existing.id &&
              hasMeaningfulReportValue(e.value_num, e.value_text) && !reportFieldFilter.allows(courseId, cycleNo, e.unit_id, e.field_key)),
            reportId: existing.id,
            vehicleId: existing.vehicle_id ?? null,
            meterValue: existing.meter_value ?? null,
            approvedAt: existing.approved_at ?? null,
            rejectedAt: existing.rejected_at ?? null,
            values: entriesByReport.get(existing.id) ?? {},
          }
        : null,
    };
  };

  const shifts = shiftChoices.filter(s => !pending.some(q => q.course_id === s.courseId && q.cycle_no === s.cycleNo)).map(makeShift);

  const shiftKeys = new Set(rawShiftChoices.map((choice: any) => `${choice.courseId}:${choice.cycleNo}`));
  const legacyCourses = new Set((existingReports ?? []).filter((report: any) => !report.rejected_at && (Number(report.cycle_no) || 0) === 0).map((report: any) => report.course_id));
  const candidates = includeCandidates ? (courses ?? []).flatMap((c: any) => {
    const memberCycles = memberCyclesByCourse.get(c.id);
    if (!memberCycles || c.archived_at || (c.uses_cycles && legacyCourses.has(c.id))) return [];
    const cycles: { cycle_no: number; label: string | null }[] = c.uses_cycles
      ? (c.course_cycles ?? []).filter((cycle: any) => cycle.active !== false)
      : [{ cycle_no: 0, label: null }];
    return cycles.filter(cycle => (memberCycles.has(0) || memberCycles.has(cycle.cycle_no)) &&
      !shiftKeys.has(`${c.id}:${cycle.cycle_no}`)).map(cycle =>
      ({ ...makeShift({ courseId: c.id, cycleNo: cycle.cycle_no }), existing: null }));
  }) : [];
  const requestedShifts = pending.map(q => {
    const form = makeShift({ courseId: q.course_id, cycleNo: q.cycle_no });
    const payload = q.payload as { vehicleId?: string; meterValue?: number; entries?: { unitId: string; fieldKey: string; valueNum?: number; valueText?: string }[] };
    const values: Record<string, Record<string, number | string>> = {};
    for (const e of payload.entries ?? []) { values[e.unitId] ??= {}; values[e.unitId][e.fieldKey] = e.valueNum ?? e.valueText ?? ""; }
    const c = courseById.get(q.course_id);
    return { ...form, requestId: q.id, requestAssigned: shiftKeys.has(`${q.course_id}:${q.cycle_no}`), existing: { reportId: q.id, vehicleId: payload.vehicleId ?? null, meterValue: payload.meterValue ?? null,
      approvedAt: null, rejectedAt: null, values, requiresReview: !c || !!c.archived_at || (c.uses_cycles && !(c.course_cycles ?? []).some((cycle: any) => cycle.cycle_no === q.cycle_no && cycle.active !== false)) ||
        (payload.entries ?? []).some(e => hasMeaningfulReportValue(e.valueNum, e.valueText) && !reportFieldFilter.allows(q.course_id, q.cycle_no, e.unitId, e.fieldKey)) } };
  });
  const { data: currentRevision, error: currentError } = await supabase.rpc("report_day_revision", { p_org: orgId, p_driver: user.driverId, p_date: date });
  if (currentError || currentRevision !== revision) return NextResponse.json({ error: "日報が変更されています。再読み込みしてください" }, { status: 409 });
  return NextResponse.json({ shifts: [...shifts, ...requestedShifts], shiftVehicleId, vehicleReturnRequired, revision,
    rejectedRequests: (requests ?? []).filter(q => q.status === "rejected").map(q => ({ id: q.id, courseName: courseById.get(q.course_id)?.name ?? "コース", cycleNo: q.cycle_no })),
    ...(includeCandidates ? { candidates } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
}
