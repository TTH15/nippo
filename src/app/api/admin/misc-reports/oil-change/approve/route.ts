import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadReportKinds } from "@/server/reportKinds/config";
import { getRoleValue, getAnswerValue } from "@/server/reportKinds/answers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { data: report, error: reportErr } = await supabase
      .from("oil_change_reports")
      .select("driver_id, report_date, report_kind, description, expense_amount, vehicle_id, odometer_km, answers")
      .eq("id", id)
      .maybeSingle();

    if (reportErr) {
      console.error("[admin/misc-reports/oil-change/approve] report error", reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const { error } = await supabase
      .from("oil_change_reports")
      .update({
        approved_at: new Date().toISOString(),
        approved_by: user.driverId,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("id", id);

    if (error) {
      console.error("[admin/misc-reports/oil-change/approve] error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    // 種別の能力(capability)で承認時の特別処理を決める。値は role フィールド(answers)から解決。
    const reportKinds = await loadReportKinds(supabase);
    const kind = reportKinds.find((k) => k.key === report?.report_kind) ?? null;
    const capability = kind?.capability ?? "none";
    const fields = kind?.fields ?? [];
    const odometerValue = report ? getRoleValue(report, fields, "odometer") : null;
    const amountValue = report ? getRoleValue(report, fields, "amount") : null;

    if (
      capability === "oil_mileage" &&
      report?.vehicle_id &&
      odometerValue != null
    ) {
      const odo = Math.trunc(odometerValue);
      const { data: veh } = await supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", report.vehicle_id)
        .maybeSingle();
      const current = veh ? Number(veh.current_mileage) || 0 : 0;
      const update: Record<string, unknown> = {
        last_oil_change_mileage: odo,
        updated_at: new Date().toISOString(),
      };
      // 「前回オイル交換 ≤ 現在走行距離」を保つ。
      // オイル交換が日報より先に報告された場合は、現在走行距離もその値まで引き上げる。
      if (odo > current) update.current_mileage = odo;
      const { error: vehicleErr } = await supabase
        .from("vehicles")
        .update(update)
        .eq("id", report.vehicle_id);
      if (vehicleErr) {
        console.error("[admin/misc-reports/oil-change/approve] vehicle update error", vehicleErr);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
    }

    if (
      capability === "expense" &&
      report?.driver_id &&
      report?.report_date &&
      amountValue != null
    ) {
      const month = String(report.report_date).slice(0, 7);
      const amountYen = Math.trunc(amountValue || 0);
      if (month.match(/^\d{4}-\d{2}$/) && amountYen > 0) {
        // 経費タイトル: amount以外のテキスト系フィールドの回答 → 無ければ description。
        const textField = fields.find((f) => (f.type === "short_text" || f.type === "long_text"));
        const rawTitle = String(
          (textField && report ? getAnswerValue(report, textField) : "") || report.description || "",
        ).trim();
        const title = rawTitle ? `経費報告: ${rawTitle}` : "経費報告";
        const name = title.length > 200 ? title.slice(0, 200) : title;
        const payload = {
          driver_id: report.driver_id,
          month,
          name,
          // ペイメントでは控除(+)を差し引く設計のため、加算は負値で保持する
          amount: -amountYen,
          misc_report_id: id,
          updated_at: new Date().toISOString(),
        };
        // misc_report_id の一意制約は「部分ユニークインデックス(WHERE misc_report_id IS NOT NULL)」
        // のため PostgREST の onConflict upsert が一致せずエラー(42P10)になる。
        // 既存行を引いてから update / insert する手動 upsert にする。
        const { data: existingAdHoc, error: findAdHocErr } = await supabase
          .from("driver_ad_hoc_expenses")
          .select("id")
          .eq("misc_report_id", id)
          .maybeSingle();
        if (findAdHocErr) {
          console.error("[admin/misc-reports/oil-change/approve] ad hoc find error", findAdHocErr);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
        const { error: adHocErr } = existingAdHoc
          ? await supabase.from("driver_ad_hoc_expenses").update(payload).eq("id", existingAdHoc.id)
          : await supabase.from("driver_ad_hoc_expenses").insert(payload);
        if (adHocErr) {
          console.error("[admin/misc-reports/oil-change/approve] ad hoc upsert error", adHocErr);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/misc-reports/oil-change/approve] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
