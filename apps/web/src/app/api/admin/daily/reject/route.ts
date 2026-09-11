import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_edit_reports");
  if (isAuthError(user)) return user;
  try {
    // driverId はリクエスト body 由来なので、必ず運営自身の org で絞る（他社日報の却下を防ぐ）
    const orgId = await resolveOrgId(user.driverId);
    const body = await req.json();
    const driverId = String(body.driverId ?? "");
    const date = String(body.date ?? "");

    if (!driverId || !date) {
      return NextResponse.json({ error: "driverId and date are required" }, { status: 400 });
    }

    const { data: driver, error: driverErr } = await supabase.from("drivers")
      .select("id").eq("id", driverId).eq("org_id", orgId).maybeSingle();
    if (driverErr) return NextResponse.json({ error: "DB error" }, { status: 500 });
    if (!driver) return NextResponse.json({ error: "日報が見つかりません。" }, { status: 404 });

    const { data: rejected, error } = await supabase
      .from("daily_reports_v2")
      .update({
        approved_at: null,
        approved_by: null,
        rejected_at: new Date().toISOString(),
        rejected_by: user.driverId,
      })
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .eq("report_date", date)
      // 却下対象は「未却下」の日報のみ（却下済みが同日に残っていてもOK）
      .is("rejected_at", null).select("id");

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (!rejected?.length) return NextResponse.json({ error: "日報が見つかりません。" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

