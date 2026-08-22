import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { logShiftChange } from "@/server/shiftLog";

export const dynamic = "force-dynamic";

// POST: シフト行への車両割当（配車）。シフト編集（can_manage_shifts）から独立した
// can_dispatch でゲートし、「シフト閲覧＋配車のみ」の配車担当ロールを可能にする（A1）。
// 既存シフト行の車両フィールドのみ更新する（割当・解除は /api/admin/shifts）。
//   { shiftDate, courseId, slot, vehicleId: string|null, usesExternalVehicle?: boolean }
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_dispatch");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { shiftDate, courseId, slot, cycleNo, vehicleId, usesExternalVehicle } = body as {
      shiftDate?: string;
      courseId?: string;
      slot?: number;
      cycleNo?: number;
      /** null で車両をクリア */
      vehicleId?: string | null;
      /** 他社の車両を利用するフラグ */
      usesExternalVehicle?: boolean;
    };

    if (!shiftDate || !courseId) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    const slotNumber = Number.isFinite(slot) && Number(slot) >= 1 ? Math.floor(Number(slot)) : 1;
    const cycleNumber = Number.isInteger(cycleNo) && Number(cycleNo) >= 0 ? Number(cycleNo) : 0;

    // 他社車両フラグが立っているときは自社フリート車両をクリアする。
    const external = usesExternalVehicle === true;
    const resolvedVehicleId =
      !external && vehicleId && typeof vehicleId === "string" ? vehicleId : null;

    // 貸出中の車両はその日付に紐付け不可。
    if (resolvedVehicleId) {
      const { data: vehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .select("id, is_disposed, is_unavailable, unavailable_reason")
        .eq("id", resolvedVehicleId)
        .eq("owner_org_id", user.orgId)
        .maybeSingle();
      if (vehicleError) throw vehicleError;
      if (!vehicle || vehicle.is_disposed) {
        return NextResponse.json(
          { error: "この車両は現在利用できません。" },
          { status: 409 },
        );
      }
      if (vehicle.is_unavailable) {
        const reason = typeof vehicle.unavailable_reason === "string" && vehicle.unavailable_reason.trim()
          ? `（${vehicle.unavailable_reason.trim()}）`
          : "";
        return NextResponse.json(
          { error: `この車両は一時使用不可に設定されています${reason}。` },
          { status: 409 },
        );
      }

      const { data: loan } = await supabase
        .from("vehicle_loans")
        .select("id")
        .eq("vehicle_id", resolvedVehicleId)
        .eq("loan_date", shiftDate)
        .maybeSingle();
      if (loan) {
        return NextResponse.json(
          { error: "この車両は同日が貸出中のため、シフトに紐付けできません。" },
          { status: 409 },
        );
      }
    }

    // 変更ログ用に変更前の配車を読む（ログはベストエフォート）。
    const { data: prevRow } = await supabase
      .from("shifts")
      .select("vehicle_id, uses_external_vehicle")
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("cycle_no", cycleNumber)
      .eq("slot", slotNumber)
      .maybeSingle();

    const { data, error } = await supabase
      .from("shifts")
      .update({
        vehicle_id: resolvedVehicleId,
        uses_external_vehicle: external,
        updated_at: new Date().toISOString(),
      })
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("cycle_no", cycleNumber)
      .eq("slot", slotNumber)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "対象のシフトが見つかりません。先にシフトを割り当ててください。" },
        { status: 404 },
      );
    }

    if (
      (prevRow?.vehicle_id ?? null) !== resolvedVehicleId ||
      (prevRow?.uses_external_vehicle ?? false) !== external
    ) {
      void logShiftChange({
        orgId: user.orgId,
        actorDriverId: user.driverId,
        action: "assign_vehicle",
        shiftDate,
        courseId,
        slot: slotNumber,
        before: {
          vehicleId: prevRow?.vehicle_id ?? null,
          usesExternalVehicle: prevRow?.uses_external_vehicle ?? false,
        },
        after: { vehicleId: resolvedVehicleId, usesExternalVehicle: external },
      });
    }

    return NextResponse.json({ shift: data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
