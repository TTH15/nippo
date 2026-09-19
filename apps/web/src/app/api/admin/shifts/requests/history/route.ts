import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { belongsToOrg } from "@/server/db/adminResourceScope";

export const dynamic = "force-dynamic";

// GET: 指定ドライバー×日付の希望休 変更履歴（時系列）。運営UIの初回提出/最終変更表示用。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;

  const driverId = req.nextUrl.searchParams.get("driverId");
  const date = req.nextUrl.searchParams.get("date");
  if (!driverId || !date) {
    return NextResponse.json({ error: "driverId and date required" }, { status: 400 });
  }
  // ★自社のドライバーの履歴だけを返す。org_id（migration 174）は移行中で NULL の行も
  //   ありうるため、所属の判定は drivers 側で行う。
  if (!(await belongsToOrg("drivers", driverId, user.orgId))) {
    return NextResponse.json({ error: "対象のドライバーが見つかりません。" }, { status: 404 });
  }

  const { data, error } = await supabase
    // tenant-scope-ok: 直上の belongsToOrg で自社のドライバーと確認済みの driverId に固定
    .from("shift_request_logs")
    .select("action, actor_type, actor_name, slot_id, slot_name, created_at")
    .eq("driver_id", driverId)
    .eq("request_date", date)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[/api/admin/shifts/requests/history] GET error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [] });
}
