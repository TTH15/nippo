import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// GET: ドライバーの当日の業務状態。アプリ復帰時の同期に使う。
// open=稼働中セッション（あれば退勤へ誘導）、today=本日のセッション一覧。
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, "DRIVER"); // テナント整合（孤児セッションは401）
  if (ctx instanceof NextResponse) return ctx;
  const { user } = ctx;

  const startOfDayJst = `${todayJST()}T00:00:00+09:00`;

  const [openRes, todayRes] = await Promise.all([
    supabase
      .from("vehicle_sessions")
      .select("*")
      .eq("recorded_by", user.driverId)
      .eq("status", "open")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("vehicle_sessions")
      .select("*")
      .eq("recorded_by", user.driverId)
      .gte("started_at", startOfDayJst)
      .order("started_at", { ascending: false }),
  ]);

  return NextResponse.json({
    open: openRes.data ?? null,
    today: todayRes.data ?? [],
  });
}
