import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_edit_reports");
  if (isAuthError(user)) return user;
  // driverId はリクエスト body 由来なので、必ず運営自身の org で絞る（他社日報の承認を防ぐ）
  const orgId = await resolveOrgId(user.driverId);

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
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .eq("report_date", date)
      .is("rejected_at", null);

    if (reportErr) {
      console.error(reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    // 車両ごとに、その日の最大メーター値を採用（複数コース行の last-row-wins を排除）。
    const maxMeterByVehicle = new Map<string, number>();
    for (const r of reportRows ?? []) {
      if (r.vehicle_id && r.meter_value != null) {
        const v = Number(r.meter_value);
        if (!Number.isFinite(v)) continue;
        maxMeterByVehicle.set(r.vehicle_id, Math.max(maxMeterByVehicle.get(r.vehicle_id) ?? -Infinity, v));
      }
    }

    // 走行距離は前進のみ更新。現在登録より小さければ更新せず警告（巻き戻り＝誤入力の疑い）。
    const warnings: string[] = [];
    for (const [vehicleId, meter] of maxMeterByVehicle) {
      const { data: veh } = await supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", vehicleId)
        .maybeSingle();
      const current = veh ? Number(veh.current_mileage) || 0 : 0;
      if (meter >= current) {
        const { error: vehicleErr } = await supabase
          .from("vehicles")
          .update({ current_mileage: meter, updated_at: new Date().toISOString() })
          .eq("id", vehicleId);
        if (vehicleErr) {
          console.error(vehicleErr);
          return NextResponse.json({ error: "DB error" }, { status: 500 });
        }
      } else {
        warnings.push(
          `メーター値 ${meter.toLocaleString()} km が現在の登録 ${current.toLocaleString()} km より小さいため、` +
          `車両の走行距離は更新しませんでした（巻き戻りの可能性）。`,
        );
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
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .eq("report_date", date)
      .is("rejected_at", null);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, warnings });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

