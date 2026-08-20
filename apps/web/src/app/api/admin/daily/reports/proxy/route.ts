import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { captureReportRateSnapshots } from "@/server/aggregation/rateSnapshot";

export const dynamic = "force-dynamic";

// ============================================================
// 運営の代理入力：指定ドライバーの日報を運営が新規作成/上書きする。
//   ドライバーが提出していない過去分などを、運営が個数を入れて集計に乗せる用途。
//   作成後はそのまま承認済みにする（集計は approved_at != null のみ対象のため）。
//   (driver, date, course) 単位で上書き。entries は report_entries(縦持ち)。
// ============================================================

type EntryInput = { unitId: string; fieldKey: string; valueNum?: number | null; valueText?: string | null };
type ItemInput = {
  courseId: string;
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

  // シフト未登録の場合は不可（売上・報酬計算がシフト基準のため）
  const { data: shiftRow } = await supabase
    .from("shifts")
    .select("id")
    .eq("driver_id", driverId)
    .eq("shift_date", reportDate)
    .limit(1)
    .maybeSingle();
  if (!shiftRow) {
    return NextResponse.json(
      { error: "シフト未登録のため代理入力できません。先にシフト登録をしてください。" },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  const savedReportIds: string[] = [];
  // driverId は body 由来。運営自身の org を正とし、対象ドライバーがその org の
  // メンバーであることを確認してから書き込む（他社ドライバーの日報を作らせない）。
  const orgId = await resolveOrgId(user.driverId);
  const { data: targetDriver } = await supabase
    .from("drivers")
    .select("id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!targetDriver) return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });

  for (const item of items) {
    if (!item.courseId) continue;

    // 既存（未却下）の同 (driver,date,course) を探して上書き、無ければ作成
    const { data: existing } = await supabase
      .from("daily_reports_v2")
      .select("id")
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .eq("report_date", reportDate)
      .eq("course_id", item.courseId)
      .is("rejected_at", null)
      .maybeSingle();

    const header = {
      org_id: orgId,
      driver_id: driverId,
      report_date: reportDate,
      course_id: item.courseId,
      carrier_id: item.carrierId ?? null,
      vehicle_id: item.vehicleId ?? null,
      meter_value: typeof item.meterValue === "number" ? item.meterValue : null,
      submitted_at: nowIso,
      // 代理入力はそのまま承認済みにする（集計に即反映）
      approved_at: nowIso,
      approved_by: user.driverId,
      rejected_at: null,
      rejected_by: null,
    };

    let reportId: string;
    if (existing?.id) {
      const { error } = await supabase.from("daily_reports_v2").update(header).eq("id", existing.id);
      if (error) {
        console.error(error);
        return NextResponse.json({ error: "日報の更新に失敗しました" }, { status: 500 });
      }
      reportId = existing.id;
      await supabase.from("report_entries").delete().eq("report_id", reportId);
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
        report_id: reportId,
        unit_id: e.unitId,
        field_key: e.fieldKey,
        value_num: typeof e.valueNum === "number" ? e.valueNum : null,
        value_text: e.valueText != null ? String(e.valueText) : null,
      }));
    if (entryRows.length > 0) {
      const { error } = await supabase.from("report_entries").insert(entryRows);
      if (error) {
        console.error(error);
        return NextResponse.json({ error: "報告項目の保存に失敗しました" }, { status: 500 });
      }
    }
    savedReportIds.push(reportId);
  }

  await captureReportRateSnapshots(supabase, orgId, savedReportIds);

  return NextResponse.json({ ok: true, reportIds: savedReportIds });
}
