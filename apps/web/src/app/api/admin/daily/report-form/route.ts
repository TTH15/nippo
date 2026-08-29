import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { resolveReportCycleChoices } from "@repo/core/logic/dailyReport";
import { loadCourseReportFields } from "@/server/reports/courseReportFields";

export const dynamic = "force-dynamic";

// ============================================================
// 運営の代理入力用：指定ドライバー・日付の動的日報フォームを返す。
//   /api/me/report-form の運営版。driverId を明示的に受け取り、
//   その日のシフト(=コース)ごとにキャリア配下の unit / unit_fields を返す。
//   既存 daily_reports_v2 + report_entries があれば prefill 用に同梱。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;

  const driverId = req.nextUrl.searchParams.get("driverId") ?? "";
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!driverId) return NextResponse.json({ error: "driverId が必要です" }, { status: 400 });
  if (!date) return NextResponse.json({ error: "date が必要です" }, { status: 400 });

  // driverId はクエリ由来。対象ドライバーが自 org のメンバーであることを先に確認する
  // （以降の shifts / courses / daily_reports_v2 の参照が他社に及ばないようにするため）。
  const orgId = await resolveOrgId(user.driverId);
  const { data: targetDriver } = await supabase
    .from("drivers")
    .select("id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!targetDriver) return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });

  // その日のシフト（コース）
  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("course_id, cycle_no, slot, vehicle_id")
    .eq("driver_id", driverId)
    .eq("shift_date", date)
    .order("slot");

  const rawShiftVehicleId: string | null =
    (shiftRows ?? []).map((s: any) => s.vehicle_id).find((v: string | null) => !!v) ?? null;
  const courseIds = Array.from(new Set((shiftRows ?? []).map((s: any) => s.course_id).filter(Boolean)));
  const rawShiftChoices = Array.from(
    new Map(
      (shiftRows ?? [])
        .filter((s: any) => s.course_id)
        .map((s: any) => [`${s.course_id}:${Number(s.cycle_no) || 0}`, { courseId: s.course_id, cycleNo: Number(s.cycle_no) || 0 }]),
    ).values(),
  );

  // shifts 以外に依存しない取得は1波にまとめる（旧: 直列の積み上げ。me/report-form と同型）
  const [{ data: shiftVehicle }, { data: courses }, { data: existingReports }] = await Promise.all([
    // その日にシフトで割り当てられた車両（先頭の非null）。廃車・一時使用不可は既定から除外
    rawShiftVehicleId
      ? supabase.from("vehicles").select("is_disposed, is_unavailable").eq("id", rawShiftVehicleId).maybeSingle()
      : Promise.resolve({ data: null as { is_disposed: boolean; is_unavailable: boolean } | null }),
    // コース → キャリア
    courseIds.length
      ? supabase.from("courses").select("id, name, color, summary_title, carrier_id, course_cycles(cycle_no, label)").in("id", courseIds)
      : Promise.resolve({ data: [] as any[] }),
    // 既存 v2 レポート（prefill）
    courseIds.length
      ? supabase
          .from("daily_reports_v2")
          .select("id, course_id, cycle_no, vehicle_id, meter_value, approved_at, rejected_at")
          .eq("org_id", orgId)
          .eq("driver_id", driverId)
          .eq("report_date", date)
          .in("course_id", courseIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const shiftVehicleId =
    rawShiftVehicleId && !shiftVehicle?.is_disposed && !shiftVehicle?.is_unavailable
      ? rawShiftVehicleId
      : null;

  if (courseIds.length === 0) {
    return NextResponse.json({ shifts: [], shiftVehicleId });
  }

  const carrierIds = Array.from(new Set((courses ?? []).map((c: any) => c.carrier_id).filter(Boolean)));
  const reportIds = (existingReports ?? []).map((r: any) => r.id);

  const [{ data: carriers }, { data: units }, { data: existingEntries }] = await Promise.all([
    carrierIds.length ? supabase.from("carriers").select("id, name").in("id", carrierIds) : Promise.resolve({ data: [] as any[] }),
    carrierIds.length
      ? supabase.from("units").select("id, carrier_id, name, code, billing_type, sort_order, active").in("carrier_id", carrierIds).eq("active", true).order("sort_order")
      : Promise.resolve({ data: [] as any[] }),
    reportIds.length
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
    (existingReports ?? []).map((r: any) => [`${r.course_id}:${Number(r.cycle_no) || 0}`, r]),
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

  const shifts = shiftChoices.map(({ courseId, cycleNo }) => {
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
            reportId: existing.id,
            vehicleId: existing.vehicle_id ?? null,
            meterValue: existing.meter_value ?? null,
            approvedAt: existing.approved_at ?? null,
            rejectedAt: existing.rejected_at ?? null,
            values: entriesByReport.get(existing.id) ?? {},
          }
        : null,
    };
  });

  return NextResponse.json({ shifts, shiftVehicleId });
}
