import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

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

  const { data, error } = await supabase
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
