import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import { reportLifecycleError } from "@/server/reports/lifecycleError";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_edit_reports");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  if (!isUuid(body?.driverId) || !isDateOnly(body?.date) ||
      (body.expectedRevision != null && typeof body.expectedRevision !== "string") ||
      (body.requestIds != null && (!Array.isArray(body.requestIds) || body.requestIds.length > 100 || body.requestIds.some((id: unknown) => !isUuid(id))))) {
    return NextResponse.json({ error: "対象を確認してください" }, { status: 400 });
  }
  try {
    const orgId = await resolveOrgId(user.driverId);
    const { data, error } = await supabase.rpc("decide_report_day", {
      p_org: orgId, p_actor: user.driverId, p_driver: body.driverId, p_date: body.date,
      p_approve: false, p_expected: body.expectedRevision ?? null, p_requests: body.requestIds ?? [],
    });
    if (error) return reportLifecycleError(error, "日報を保存できませんでした。もう一度お試しください");
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "日報を保存できませんでした" }, { status: 500 });
  }
}
