import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { adminMutationError, belongsToOrg, isDateOnly, isUuid } from "@/server/db/adminResourceScope";
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
    const {
      shiftDate, courseId, slot, cycleNo, vehicleId, usesExternalVehicle,
      expectedVehicleId, hasExpectation,
    } = body as {
      shiftDate?: string;
      courseId?: string;
      slot?: number;
      cycleNo?: number;
      /** null で車両をクリア */
      vehicleId?: string | null;
      /** 他社の車両を利用するフラグ */
      usesExternalVehicle?: boolean;
      /** 画面で見ていたその枠の車両。違っていれば保存せず 409（O-3 の後勝ち防止） */
      expectedVehicleId?: string | null;
      hasExpectation?: boolean;
    };

    if (!isDateOnly(shiftDate) || !isUuid(courseId) || (vehicleId != null && !isUuid(vehicleId))) {
      return NextResponse.json({ error: "shiftDate and courseId are required" }, { status: 400 });
    }

    if (!await belongsToOrg("courses", courseId, user.orgId)) {
      return NextResponse.json({ error: "対象のコースが見つかりません。" }, { status: 404 });
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

      const { data: loan, error: loanError } = await supabase
        .from("vehicle_loans")
        .select("id")
        .eq("vehicle_id", resolvedVehicleId)
        .eq("loan_date", shiftDate)
        .maybeSingle();
      if (loanError) throw loanError;
      if (loan) {
        return NextResponse.json(
          { error: "この車両は同日が貸出中のため、シフトに紐付けできません。" },
          { status: 409 },
        );
      }
    }

    // 変更ログ用に変更前の配車を読む（ログはベストエフォート）。
    const { data: prevRow, error: previousError } = await supabase
      // tenant-scope-ok: 直上の belongsToOrg で自社のコースと確認済みの courseId に固定
      .from("shifts")
      .select("driver_id, vehicle_id, uses_external_vehicle")
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("cycle_no", cycleNumber)
      .eq("slot", slotNumber)
      .maybeSingle();

    if (previousError) throw previousError;
    if (prevRow?.driver_id && !await belongsToOrg("drivers", prevRow.driver_id, user.orgId)) {
      return NextResponse.json({ error: "対象の配車が見つかりません。" }, { status: 404 });
    }
    // 画面で見ていた車両を条件に入れる（migration 不要の楽観ロック）。
    // 条件に合わなければ0行更新になり、下で「他の人が変えた」と「枠が無い」を見分ける。
    const expects = hasExpectation === true;
    let update = supabase
      // tenant-scope-ok: 直上の belongsToOrg で自社のコースと確認済みの courseId に固定
      .from("shifts")
      .update({
        vehicle_id: resolvedVehicleId,
        uses_external_vehicle: external,
        updated_at: new Date().toISOString(),
      })
      .eq("shift_date", shiftDate)
      .eq("course_id", courseId)
      .eq("cycle_no", cycleNumber)
      .eq("slot", slotNumber);
    if (expects) {
      update = expectedVehicleId == null
        ? update.is("vehicle_id", null)
        : update.eq("vehicle_id", expectedVehicleId);
    }
    const { data, error } = await update.select().maybeSingle();

    if (error) throw error;
    if (!data) {
      // 枠自体はあるのに更新できなかった＝読み込み後に他の人が車両を変えた
      if (expects && prevRow) {
        return NextResponse.json(
          { error: "別の変更が保存されています。最新の状態を確認してください。", conflict: true },
          { status: 409 },
        );
      }
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
        cycleNo: cycleNumber,
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
    return adminMutationError(err);
  }
}
