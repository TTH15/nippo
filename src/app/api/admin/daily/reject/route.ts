import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { mirrorApprovalToV2 } from "@/server/aggregation/legacySync";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const driverId = String(body.driverId ?? "");
    const date = String(body.date ?? "");

    if (!driverId || !date) {
      return NextResponse.json({ error: "driverId and date are required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("daily_reports")
      .update({
        approved_at: null,
        approved_by: null,
        rejected_at: new Date().toISOString(),
        rejected_by: user.driverId,
      })
      .eq("driver_id", driverId)
      .eq("report_date", date)
      // 却下対象は「未却下」の日報のみ（却下済みが同日に残っていてもOK）
      .is("rejected_at", null);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    // v2 へ却下状態をミラー（移行期の整合・best-effort）
    try {
      await mirrorApprovalToV2(driverId, date);
    } catch (e) {
      console.error("mirrorApprovalToV2 failed (non-fatal)", e);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

