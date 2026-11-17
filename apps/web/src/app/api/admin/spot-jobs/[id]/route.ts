import { saveSpotJob } from "@/server/spotJobWrite";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  DATE_RE,
  SPOT_JOB_STATUSES,
  fetchSpotJob,
  normalizeAmount,
  normalizeTime,
  parseMembers,
  verifyDriversInOrg,
} from "@/server/spotJobs";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "案件が見つかりません" }, { status: 404 });

// PATCH: 単発案件の編集。members を渡すと参加者を丸ごと置き換える。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;
  return saveSpotJob(orgId, user.driverId, id, await req.json().catch(() => null), user.capabilities?.has("can_view_sales") === true && user.capabilities.has("can_view_profit"), user.capabilities?.has("can_view_sales") === true);
}

// DELETE: 単発案件を削除（参加者は CASCADE で消える）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { error } = await supabase.from("spot_jobs").delete().eq("id", id).eq("org_id", orgId);
  if (error) {
    console.error("[spot-jobs] delete error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
