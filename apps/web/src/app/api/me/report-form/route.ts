import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

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

  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!date) return NextResponse.json({ error: "date が必要です" }, { status: 400 });

  // その日のシフト（コース）
  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("course_id, slot, vehicle_id")
    .eq("driver_id", user.driverId)
    .eq("shift_date", date)
    .order("slot");

  const rawShiftVehicleId: string | null =
    (shiftRows ?? []).map((s: any) => s.vehicle_id).find((v: string | null) => !!v) ?? null;
  const courseIds = Array.from(new Set((shiftRows ?? []).map((s: any) => s.course_id).filter(Boolean)));

  // shifts 以外に依存しない取得は1波にまとめる（旧: 7段直列。日付変更のたび全往復していた）
  const [{ data: shiftVehicle }, { data: courses }, { data: existingReports }] = await Promise.all([
    // その日にシフトで割り当てられた車両（先頭の非null）。廃車(is_disposed)は既定車両から除外
    rawShiftVehicleId
      ? supabase.from("vehicles").select("is_disposed").eq("id", rawShiftVehicleId).maybeSingle()
      : Promise.resolve({ data: null as { is_disposed: boolean } | null }),
    // コース → キャリア
    courseIds.length
      ? supabase.from("courses").select("id, name, color, summary_title, carrier_id").in("id", courseIds)
      : Promise.resolve({ data: [] as any[] }),
    // 既存 v2 レポート（prefill）
    courseIds.length
      ? supabase
          .from("daily_reports_v2") // tenant-scope-ok: 本人（user.driverId）の日報のみ＝org をまたがない
          .select("id, course_id, vehicle_id, meter_value, approved_at, rejected_at")
          .eq("driver_id", user.driverId)
          .eq("report_date", date)
          .in("course_id", courseIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const shiftVehicleId = rawShiftVehicleId && !shiftVehicle?.is_disposed ? rawShiftVehicleId : null;

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
  const unitsByCarrier = new Map<string, any[]>();
  (units ?? []).forEach((u: any) => {
    const arr = unitsByCarrier.get(u.carrier_id) ?? [];
    arr.push({ id: u.id, name: u.name, code: u.code, billingType: u.billing_type, fields: fieldsByUnit.get(u.id) ?? [] });
    unitsByCarrier.set(u.carrier_id, arr);
  });

  const reportByCourse = new Map<string, any>((existingReports ?? []).map((r: any) => [r.course_id, r]));
  const entriesByReport = new Map<string, Record<string, Record<string, number | string>>>();
  (existingEntries ?? []).forEach((e: any) => {
    const m = entriesByReport.get(e.report_id) ?? {};
    m[e.unit_id] = m[e.unit_id] ?? {};
    m[e.unit_id][e.field_key] = e.value_num != null ? Number(e.value_num) : (e.value_text ?? "");
    entriesByReport.set(e.report_id, m);
  });

  const courseById = new Map<string, any>((courses ?? []).map((c: any) => [c.id, c]));

  const shifts = courseIds.map((courseId) => {
    const c = courseById.get(courseId);
    const existing = reportByCourse.get(courseId);
    return {
      courseId,
      courseName: c?.summary_title?.trim() || c?.name || "",
      color: c?.color ?? null,
      carrierId: c?.carrier_id ?? null,
      carrierName: c?.carrier_id ? carrierName.get(c.carrier_id) ?? "" : "",
      units: c?.carrier_id ? unitsByCarrier.get(c.carrier_id) ?? [] : [],
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
