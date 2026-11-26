import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import { supabase } from "@/server/db/client";
import { validateReportFieldWrites } from "@/server/reports/validateFieldWrites";
import { reportLifecycleError } from "@/server/reports/lifecycleError";
import { loadReportVehicles } from "@/server/vehicles/reportScope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const date = req.nextUrl.searchParams.get("date");
  if (!isDateOnly(date)) return NextResponse.json({ error: "日付を確認してください" }, { status: 400 });
  try {
    const orgId = await resolveOrgId(user.driverId);
    const { data, error } = await supabase.from("report_course_requests")
      .select("id,course_id,cycle_no,payload,submitted_at")
      .eq("org_id", orgId).eq("driver_id", user.driverId).eq("report_date", date).eq("status", "pending");
    if (error) throw error;
    return NextResponse.json({ requests: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "日報を読み込めませんでした" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "日報を確認してください" }, { status: 400 });
  try {
    const orgId = await resolveOrgId(user.driverId);
    const { data, error } = await supabase.rpc("cancel_report_course_request", { p_org: orgId, p_driver: user.driverId, p_id: id });
    if (error?.code === "40001") return NextResponse.json({ error: "申請が変更されています。再読み込みしてください" }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ ok: true, revision: data });
  } catch {
    return NextResponse.json({ error: "申請を取り消せませんでした" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  const date = body?.reportDate;
  const item = body?.item;
  if (typeof body?.expectedRevision !== "string" || !isDateOnly(date) || !item || !isUuid(item.courseId) || !Number.isInteger(item.cycleNo) || item.cycleNo < 0 ||
      !Array.isArray(item.entries) || item.entries.length > 200 ||
      (item.vehicleId != null && !isUuid(item.vehicleId)) ||
      (body.identityId != null && !isUuid(body.identityId)) ||
      (item.meterValue != null && (!Number.isInteger(item.meterValue) || item.meterValue < 0))) {
    return NextResponse.json({ error: "日報の内容を確認してください" }, { status: 400 });
  }
  const entries = item.entries as unknown[];
  if (entries.some(value => {
    if (!value || typeof value !== "object") return true;
    const entry = value as Record<string, unknown>;
    return !isUuid(entry.unitId) || typeof entry.fieldKey !== "string" || !entry.fieldKey || entry.fieldKey.length > 100 ||
      (entry.valueNum != null && (typeof entry.valueNum !== "number" || !Number.isFinite(entry.valueNum))) ||
      (entry.valueText != null && (typeof entry.valueText !== "string" || entry.valueText.length > 2000));
  })) return NextResponse.json({ error: "日報の項目を確認してください" }, { status: 400 });
  const keys = entries.map(value => { const entry = value as { unitId: string; fieldKey: string }; return `${entry.unitId}:${entry.fieldKey}`; });
  if (new Set(keys).size !== keys.length) return NextResponse.json({ error: "日報の項目が重複しています" }, { status: 400 });
  try {
    const orgId = await resolveOrgId(user.driverId);
    if (body.identityId) {
      const { data, error } = await supabase.from("driver_identities").select("id").eq("id", body.identityId).eq("driver_id", user.driverId).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "勤務区分を確認してください" }, { status: 403 });
    }
    if (item.vehicleId && !(await loadReportVehicles(supabase, orgId, [item.vehicleId], date)).length) {
      return NextResponse.json({ error: "車両が見つかりません" }, { status: 404 });
    }
    const { data: course, error: courseError } = await supabase.from("courses").select("carrier_id").eq("id", item.courseId).eq("org_id", orgId).is("archived_at", null).maybeSingle();
    if (courseError) throw courseError;
    if (!course) return NextResponse.json({ error: "コース・便が見つかりません" }, { status: 404 });
    const unitIds = [...new Set(entries.map(value => (value as { unitId: string }).unitId))];
    if (unitIds.length) {
      const { data: units, error: unitsError } = await supabase.from("units").select("id").eq("carrier_id", course.carrier_id).eq("active", true).in("id", unitIds);
      if (unitsError) throw unitsError;
      if (units?.length !== unitIds.length) return NextResponse.json({ error: "日報の項目を確認してください" }, { status: 400 });
      const { data: fields, error: fieldsError } = await supabase.from("unit_fields").select("unit_id, field_key").in("unit_id", unitIds);
      if (fieldsError) throw fieldsError;
      const allowed = new Set((fields ?? []).map(field => `${field.unit_id}:${field.field_key}`));
      if (keys.some(key => !allowed.has(key))) return NextResponse.json({ error: "日報の項目を確認してください" }, { status: 400 });
    }
    const fieldError = await validateReportFieldWrites(supabase, orgId, [item], []);
    if (fieldError) return NextResponse.json({ error: fieldError }, { status: 409 });
    const { data, error } = await supabase.rpc("save_report_course_request", {
      p_org: orgId, p_driver: user.driverId, p_date: date, p_course: item.courseId, p_cycle: item.cycleNo,
      p_expected: body.expectedRevision,
      p_payload: { identityId: body.identityId ?? null, vehicleId: item.vehicleId ?? null, meterValue: item.meterValue ?? null, entries },
    });
    if (error?.code === "P0002") return NextResponse.json({ error: "コース・便が見つかりません" }, { status: 404 });
    if (error?.code === "23514" || error?.code === "40001") return reportLifecycleError(error, "日報を保存できませんでした");
    if (error) throw error;
    return NextResponse.json({ id: data });
  } catch {
    return NextResponse.json({ error: "日報を保存できませんでした" }, { status: 500 });
  }
}
