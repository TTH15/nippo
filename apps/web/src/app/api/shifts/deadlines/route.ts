import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadDriverRule } from "@/server/shiftDeadline/config";
import { monthPeriods } from "@/lib/shiftDeadline";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// GET: 指定月(YYYY-MM)の、そのドライバーの提出期間と締切・ロック状態を返す。
//   ルール未割り当ては periods=[] ＝ 常に提出可。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const month = req.nextUrl.searchParams.get("month") ?? "";
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    return NextResponse.json({ error: "month (YYYY-MM) が必要です" }, { status: 400 });
  }
  const year = Number(m[1]);
  const mon = Number(m[2]);

  const rule = await loadDriverRule(supabase, orgId, user.driverId);
  const periods = monthPeriods(rule, year, mon, todayJST());
  return NextResponse.json({ periods, ruleName: rule?.name ?? null });
}
