import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadDriverRule } from "@/server/shiftDeadline/config";
import { upcomingDeadline, daysUntil } from "@/lib/shiftDeadline";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// 締切まで何日前から日報送信ページにリマインドを出すか。
const REMINDER_THRESHOLD_DAYS = 7;

// ドライバー向け: 次のシフト提出締切リマインド。
// 本人の締切ルールから「これから来る一番近い未締切」を求め、
// 締切まで THRESHOLD 日以内のときだけ reminder を返す（それ以外は null）。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const today = todayJST();
  const rule = await loadDriverRule(supabase, user.driverId);
  const next = upcomingDeadline(rule, today);

  let reminder: { deadline: string; daysLeft: number; label: string } | null = null;
  if (next) {
    const daysLeft = daysUntil(today, next.deadline);
    if (daysLeft >= 0 && daysLeft <= REMINDER_THRESHOLD_DAYS) {
      reminder = { deadline: next.deadline, daysLeft, label: next.label };
    }
  }

  return NextResponse.json({ reminder });
}
