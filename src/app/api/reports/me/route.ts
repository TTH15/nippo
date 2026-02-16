import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const limit = Number(req.nextUrl.searchParams.get("limit")) || 30;

  const { data, error } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("driver_id", user.driverId)
    .order("report_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ reports: data });
}
