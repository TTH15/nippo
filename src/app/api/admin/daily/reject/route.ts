import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

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
      .eq("report_date", date);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

