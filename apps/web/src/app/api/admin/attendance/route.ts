import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// GET: 指定日の勤怠（車両セッション）一覧。出退勤・稼働時間・メーター・GPS状態・打刻手段・承認状態。
// query: ?date=YYYY-MM-DD（省略時は当日JST）
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const date = req.nextUrl.searchParams.get("date") || todayJST();
  const start = `${date}T00:00:00+09:00`;
  const end = `${date}T23:59:59.999+09:00`;

  const { data: sessions, error } = await supabase
    .from("vehicle_sessions")
    .select(
      "id, vehicle_id, recorded_by, purpose, status, started_at, ended_at, start_odometer, end_odometer, start_method, end_method, start_gps_status, end_gps_status, approval_status",
    )
    .eq("org_id", orgId)
    .gte("started_at", start)
    .lte("started_at", end)
    .order("started_at", { ascending: true });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const rows = sessions ?? [];
  const driverIds = [...new Set(rows.map((r) => r.recorded_by).filter(Boolean))] as string[];
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter(Boolean))] as string[];

  const [{ data: drivers }, { data: vehicles }] = await Promise.all([
    driverIds.length
      ? supabase.from("drivers").select("id, name, display_name").in("id", driverIds)
      : Promise.resolve({ data: [] as any[] }),
    vehicleIds.length
      ? supabase
          .from("vehicles")
          .select("id, number_prefix, number_class, number_hiragana, number_numeric")
          .in("id", vehicleIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const driverMap = new Map((drivers ?? []).map((d: any) => [d.id, d]));
  const vehicleMap = new Map((vehicles ?? []).map((v: any) => [v.id, v]));

  const items = rows.map((r) => {
    const d = driverMap.get(r.recorded_by);
    const v = vehicleMap.get(r.vehicle_id);
    const plate = v
      ? [v.number_prefix, v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ")
      : "";
    const durationMin =
      r.started_at && r.ended_at
        ? Math.max(0, Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000))
        : null;
    const distance =
      r.start_odometer != null && r.end_odometer != null ? r.end_odometer - r.start_odometer : null;
    return {
      id: r.id,
      driverName: d?.display_name || d?.name || "—",
      plate,
      purpose: r.purpose,
      status: r.status, // open | closed
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationMin,
      startOdometer: r.start_odometer,
      endOdometer: r.end_odometer,
      distance,
      startMethod: r.start_method,
      endMethod: r.end_method,
      startGpsStatus: r.start_gps_status,
      endGpsStatus: r.end_gps_status,
      approvalStatus: r.approval_status, // null | pending | approved | rejected
    };
  });

  return NextResponse.json({ date, items });
}
