import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadLegacyDailyRows } from "@/server/aggregation/legacyShape";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const limit = Number(req.nextUrl.searchParams.get("limit")) || 30;

  try {
    // v2 ソース（互換リーダー）から取得。report_date 降順で limit 件。
    const rows = await loadLegacyDailyRows(supabase, { driverId: user.driverId as string });
    const reports = rows
      .sort((a, b) => b.report_date.localeCompare(a.report_date))
      .slice(0, limit);
    return NextResponse.json({ reports });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
