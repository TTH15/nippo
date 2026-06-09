import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadDeadlineConfig, loadDeadlineOverrides, loadDriverDeadline } from "@/server/shiftDeadline/config";
import { monthHalves } from "@/lib/shiftDeadline";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// GET: 指定月(YYYY-MM)の前半・後半の締切とロック状態を返す（ドライバー用）。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    return NextResponse.json({ error: "month (YYYY-MM) が必要です" }, { status: 400 });
  }
  const year = Number(m[1]);
  const mon = Number(m[2]);

  const [config, overrides, driver] = await Promise.all([
    loadDeadlineConfig(supabase),
    loadDeadlineOverrides(supabase),
    loadDriverDeadline(supabase, user.driverId),
  ]);

  const { firstHalf, secondHalf } = monthHalves(config, overrides, year, mon, todayJST(), driver);
  return NextResponse.json({ firstHalf, secondHalf });
}
