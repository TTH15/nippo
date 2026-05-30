import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const driverId = String(body.driverId ?? "");
    const date = String(body.date ?? "");

    if (!driverId || !date) {
      return NextResponse.json({ error: "driverId and date are required" }, { status: 400 });
    }

    // シフト未登録の場合は承認不可（売上・報酬計算がシフト基準のため）
    const { data: shiftRow, error: shiftErr } = await supabase
      .from("shifts")
      .select("id")
      .eq("driver_id", driverId)
      .eq("shift_date", date)
      .limit(1)
      .maybeSingle();

    if (shiftErr) {
      console.error(shiftErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!shiftRow) {
      return NextResponse.json(
        { error: "シフト未登録のため承認できません。先にシフト登録をしてください。" },
        { status: 400 },
      );
    }

    // 承認時に「その日報に紐づくメーター値」を車両へ反映する（提出時点では反映しない）。
    // v2 は1日複数コース行があり得るため、未却下の各行のメーターを車両へ反映。
    const { data: reportRows, error: reportErr } = await supabase
      .from("daily_reports_v2")
      .select("vehicle_id, meter_value")
      .eq("driver_id", driverId)
      .eq("report_date", date)
      .is("rejected_at", null);

    if (reportErr) {
      console.error(reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    for (const r of reportRows ?? []) {
      if (r.vehicle_id && r.meter_value != null) {
        const { error: vehicleErr } = await supabase
          .from("vehicles")
          .update({ current_mileage: Number(r.meter_value), updated_at: new Date().toISOString() })
          .eq("id", r.vehicle_id);
        if (vehicleErr) {
          console.error(vehicleErr);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
      }
    }

    // v2 を承認（同日同ドライバーの未却下行をまとめて）
    const { error } = await supabase
      .from("daily_reports_v2")
      .update({
        approved_at: new Date().toISOString(),
        approved_by: user.driverId,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("driver_id", driverId)
      .eq("report_date", date)
      .is("rejected_at", null);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

