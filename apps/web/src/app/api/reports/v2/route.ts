import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 新モデルの日報送信（daily_reports_v2 + report_entries）
//   1日に複数シフト(コース)がある場合、items を複数渡す。
//   各 item = 1コース分の日報。(driver, date, course) 単位で上書き。
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
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const reportDate = typeof body.reportDate === "string" ? body.reportDate : "";
  const driverIdentityId = typeof body.driverIdentityId === "string" ? body.driverIdentityId : null;
  const items: ItemInput[] = Array.isArray(body.items) ? body.items : [];

  if (!reportDate) return NextResponse.json({ error: "reportDate が必要です" }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ error: "items が空です" }, { status: 400 });

  // 勤務区分の本人確認（指定がある場合）
  if (driverIdentityId) {
    const { data: identity } = await supabase
      .from("driver_identities")
      .select("id")
      .eq("id", driverIdentityId)
      .eq("driver_id", user.driverId)
      .maybeSingle();
    if (!identity) return NextResponse.json({ error: "勤務区分が不正です" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const savedReportIds: string[] = [];
  const orgId = await resolveOrgId(user.driverId);

  for (const item of items) {
    if (!item.courseId) continue;

    // 既存（未却下）の同 (driver,date,course) を探して上書き、無ければ作成
    const { data: existing } = await supabase
      .from("daily_reports_v2")
      .select("id")
      .eq("driver_id", user.driverId)
      .eq("report_date", reportDate)
      .eq("course_id", item.courseId)
      .is("rejected_at", null)
      .maybeSingle();

    const header = {
      org_id: orgId,
      driver_id: user.driverId,
      report_date: reportDate,
      course_id: item.courseId,
      carrier_id: item.carrierId ?? null,
      identity_id: driverIdentityId,
      vehicle_id: item.vehicleId ?? null,
      meter_value: typeof item.meterValue === "number" ? item.meterValue : null,
      submitted_at: nowIso,
      // 再提出時は承認状態をリセット
      approved_at: null,
      approved_by: null,
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
      // 既存 entries を入れ替え
      await supabase.from("report_entries").delete().eq("report_id", reportId);
    } else {
      const { data, error } = await supabase.from("daily_reports_v2").insert(header).select("id").single();
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

  // Phase9 カットオーバー: v2 を source of truth とし、旧 daily_reports への
  // dual-write は廃止（旧テーブルはバックアップとして凍結）。

  return NextResponse.json({ ok: true, reportIds: savedReportIds });
}
