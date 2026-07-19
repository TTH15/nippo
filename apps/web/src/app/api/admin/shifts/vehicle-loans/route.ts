import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: 車両の日毎の貸出中を設定/解除（loaned で切替）。
// 貸出管理は配車ドメインのため can_dispatch でゲート（A1）。
//   { vehicleId, date, loaned }
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_dispatch");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const loaned = body.loaned === true;
  if (!vehicleId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "vehicleId and date (YYYY-MM-DD) are required" }, { status: 400 });
  }

  if (loaned) {
    // 紐付け済みのシフトがある日に貸出中へ切り替えるのは矛盾するため弾く。
    const { data: assigned } = await supabase
      .from("shifts")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("shift_date", date)
      .limit(1)
      .maybeSingle();
    if (assigned) {
      return NextResponse.json(
        { error: "この車両は同日のシフトに紐付け済みです。先に紐付けを解除してください。" },
        { status: 409 },
      );
    }
    const { error } = await supabase
      .from("vehicle_loans")
      .upsert({ vehicle_id: vehicleId, loan_date: date }, { onConflict: "vehicle_id,loan_date" });
    if (error) {
      console.error("[shifts/vehicle-loans] upsert error", error);
      return NextResponse.json({ error: "保存に失敗しました（migration 070 未適用の可能性）" }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("vehicle_loans")
      .delete()
      .eq("vehicle_id", vehicleId)
      .eq("loan_date", date);
    if (error) {
      console.error("[shifts/vehicle-loans] delete error", error);
      return NextResponse.json({ error: "解除に失敗しました" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
