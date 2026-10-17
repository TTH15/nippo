import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { syncReportEntries } from "@/server/reports/entries";
import { validateReportFieldWrites } from "@/server/reports/validateFieldWrites";
import { captureReportRateSnapshots } from "@/server/aggregation/rateSnapshot";

export const dynamic = "force-dynamic";

// ============================================================
// 運営の代理入力：指定ドライバーの日報を運営が新規作成/上書きする。
//   ドライバーが提出していない過去分などを、運営が個数を入れて集計に乗せる用途。
//   作成後はそのまま承認済みにする（集計は approved_at != null のみ対象のため）。
//   (driver, date, course, cycle) 単位で上書き。entries は report_entries(縦持ち)。
// ============================================================

type EntryInput = { unitId: string; fieldKey: string; valueNum?: number | null; valueText?: string | null };
type ItemInput = {
  courseId: string;
  cycleNo?: number;
  carrierId?: string | null;
  vehicleId?: string | null;
  meterValue?: number | null;
  entries: EntryInput[];
};

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_edit_reports");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const driverId = typeof body.driverId === "string" ? body.driverId : "";
  const reportDate = typeof body.reportDate === "string" ? body.reportDate : "";
  const items: ItemInput[] = Array.isArray(body.items) ? body.items : [];

  if (!driverId) return NextResponse.json({ error: "driverId が必要です" }, { status: 400 });
  if (!reportDate) return NextResponse.json({ error: "reportDate が必要です" }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ error: "items が空です" }, { status: 400 });
  const itemKeys = items.filter((item) => item.courseId)
    .map((item) => `${item.courseId}:${Number(item.cycleNo) || 0}`);
  if (new Set(itemKeys).size !== itemKeys.length) {
    return NextResponse.json({ error: "同じコース・便が重複しています" }, { status: 400 });
  }

  // ★ドライバーの所属確認はシフトを読むより前に行う。後ろに置くと、他社の driverId で
  //   他社のシフトを1度読んでから 404 を返すことになる（応答には出ないが読んでいる）。
  const orgId = await resolveOrgId(user.driverId);
  const { data: targetDriver } = await supabase
    .from("drivers")
    .select("id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!targetDriver) return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });

  // シフト未登録の場合は不可（売上・報酬計算がシフト基準のため）
  const { data: shiftRows } = await supabase
    // tenant-scope-ok: 直上で自社のドライバーと確認済みの driverId に固定
    .from("shifts")
    .select("id, course_id, cycle_no")
    .eq("driver_id", driverId)
    .eq("shift_date", reportDate);
  if (!shiftRows || shiftRows.length === 0) {
    return NextResponse.json(
      { error: "シフト未登録のため代理入力できません。先にシフト登録をしてください。" },
      { status: 400 },
    );
  }

  try {
    const { data: existingReports, error: readError } = await supabase.from("daily_reports_v2")
      .select("id, course_id, cycle_no, approved_at").eq("org_id", orgId).eq("driver_id", driverId)
      .eq("report_date", reportDate).is("rejected_at", null);
    if (readError) throw readError;
    const editable = items.filter(i => !existingReports?.some(r => r.course_id === i.courseId && (Number(r.cycle_no) || 0) === (Number(i.cycleNo) || 0) && r.approved_at));
    const fieldError = await validateReportFieldWrites(supabase, orgId, editable, existingReports ?? []);
    if (fieldError) return NextResponse.json({ error: fieldError }, { status: 409 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "日報項目の確認に失敗しました" }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const savedReportIds: string[] = [];
  const allowedShiftKeys = new Set(
    shiftRows
      .filter((row) => row.course_id)
      .map((row) => `${row.course_id}:${Number(row.cycle_no) || 0}`),
  );

  for (const item of items) {
    if (!item.courseId) continue;
    const cycleNo = Number.isInteger(item.cycleNo) && Number(item.cycleNo) >= 0 ? Number(item.cycleNo) : 0;

    // 既存（未却下）の同 (driver,date,course,cycle) を探して上書き、無ければ作成
    const { data: existing } = await supabase
      .from("daily_reports_v2")
      .select("id, approved_at")
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .eq("report_date", reportDate)
      .eq("course_id", item.courseId)
      .eq("cycle_no", cycleNo)
      .is("rejected_at", null)
      .maybeSingle();
    if (existing?.approved_at) continue;
    if (!allowedShiftKeys.has(`${item.courseId}:${cycleNo}`) && !(cycleNo === 0 && existing && shiftRows.some(s => s.course_id === item.courseId))) {
      return NextResponse.json({ error: "シフトにないコース・便は代理入力できません" }, { status: 400 });
    }

    const header = {
      org_id: orgId,
      driver_id: driverId,
      report_date: reportDate,
      course_id: item.courseId,
      cycle_no: cycleNo,
      carrier_id: item.carrierId ?? null,
      vehicle_id: item.vehicleId ?? null,
      meter_value: typeof item.meterValue === "number" ? item.meterValue : null,
      submitted_at: nowIso,
      // 明細とスナップショットが保存されるまでは未承認。
      approved_at: null,
      approved_by: null,
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
    };

    let reportId: string;
    if (existing?.id) {
      const { error } = await supabase.from("daily_reports_v2").update(header).eq("org_id", orgId).eq("id", existing.id);
      if (error) {
        console.error(error);
        return NextResponse.json({ error: "日報の更新に失敗しました" }, { status: 500 });
      }
      reportId = existing.id;
    } else {
      const { data, error } = await supabase.from("daily_reports_v2").insert(header).select("id").single(); // tenant-scope-ok: header に org_id を含む（運営自身の org）
      if (error || !data) {
        console.error(error);
        return NextResponse.json({ error: "日報の作成に失敗しました" }, { status: 500 });
      }
      reportId = data.id;
    }

    const entryRows = (item.entries ?? [])
      .filter((e) => e.unitId && e.fieldKey)
      .map((e) => ({
        org_id: orgId,
        report_id: reportId,
        unit_id: e.unitId,
        field_key: e.fieldKey,
        value_num: typeof e.valueNum === "number" ? e.valueNum : null,
        value_text: e.valueText != null ? String(e.valueText) : null,
      }));
    try {
      await syncReportEntries(supabase, orgId, reportId, entryRows);
    } catch (error) {
      console.error(error);
      return NextResponse.json({ error: "日報項目の保存に失敗しました。再読み込みして確認してください。" }, { status: 409 });
    }
    savedReportIds.push(reportId);
  }

  if (savedReportIds.length) {
    await captureReportRateSnapshots(supabase, orgId, savedReportIds);
    const { error } = await supabase.from("daily_reports_v2").update({ approved_at: nowIso, approved_by: user.driverId })
      .eq("org_id", orgId).in("id", savedReportIds).is("rejected_at", null).is("approved_at", null);
    if (error) return NextResponse.json({ error: "シフトを確認して、もう一度承認してください。" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, reportIds: savedReportIds });
}
