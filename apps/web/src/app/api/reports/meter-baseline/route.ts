import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 指定車両・日付における「前回メーター値」を返す。
// vehicles.current_mileage は承認済みの中で最も新しく反映された値の単一キャッシュのため、
// シフトを後から追加して過去日を遡って提出する場合、それより後の日付で既に記録された
// より大きい値と比較されてしまい、正しい値が「前回値以下」として弾かれることがある。
// ここでは対象日以前（同日含む）で最後に記録されたメーター値を都度検索して返す。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const vehicleId = req.nextUrl.searchParams.get("vehicleId");
  const date = req.nextUrl.searchParams.get("date");
  if (!vehicleId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "vehicleId and date (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  const { data: prevReport, error: reportErr } = await supabase
    .from("daily_reports_v2")
    .select("meter_value")
    .eq("vehicle_id", vehicleId)
    .is("rejected_at", null)
    .not("meter_value", "is", null)
    .lte("report_date", date)
    .order("report_date", { ascending: false })
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reportErr) {
    console.error("[reports/meter-baseline] report error", reportErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (prevReport?.meter_value != null) {
    return NextResponse.json({ prevKm: Number(prevReport.meter_value) });
  }

  // その日付以前に記録が無い場合（新車両など）は登録済みの現在値をベースラインにする。
  const { data: vehicle, error: vehicleErr } = await supabase
    .from("vehicles")
    .select("current_mileage")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicleErr) {
    console.error("[reports/meter-baseline] vehicle error", vehicleErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ prevKm: vehicle ? Number(vehicle.current_mileage) || 0 : 0 });
}
