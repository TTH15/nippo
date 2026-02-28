import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: reportId } = await params;
  if (!reportId) {
    return NextResponse.json({ error: "Report ID required" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const toInt = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

    const updates: Record<string, unknown> = {
      approved_at: null,
      approved_by: null,
      rejected_at: null,
      rejected_by: null,
    };
    if (body.takuhaibin_completed !== undefined) updates.takuhaibin_completed = toInt(body.takuhaibin_completed);
    if (body.takuhaibin_returned !== undefined) updates.takuhaibin_returned = toInt(body.takuhaibin_returned);
    if (body.nekopos_completed !== undefined) updates.nekopos_completed = toInt(body.nekopos_completed);
    if (body.nekopos_returned !== undefined) updates.nekopos_returned = toInt(body.nekopos_returned);
    if (body.amazon_am_mochidashi !== undefined) updates.amazon_am_mochidashi = toInt(body.amazon_am_mochidashi);
    if (body.amazon_am_completed !== undefined) updates.amazon_am_completed = toInt(body.amazon_am_completed);
    if (body.amazon_pm_mochidashi !== undefined) updates.amazon_pm_mochidashi = toInt(body.amazon_pm_mochidashi);
    if (body.amazon_pm_completed !== undefined) updates.amazon_pm_completed = toInt(body.amazon_pm_completed);
    if (body.amazon_4_mochidashi !== undefined) updates.amazon_4_mochidashi = toInt(body.amazon_4_mochidashi);
    if (body.amazon_4_completed !== undefined) updates.amazon_4_completed = toInt(body.amazon_4_completed);
    if (body.carrier !== undefined && (body.carrier === "YAMATO" || body.carrier === "AMAZON")) {
      updates.carrier = body.carrier;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await supabase
      .from("daily_reports")
      .update(updates)
      .eq("id", reportId);

    if (error) {
      console.error("[admin/daily/reports] update error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/daily/reports] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
