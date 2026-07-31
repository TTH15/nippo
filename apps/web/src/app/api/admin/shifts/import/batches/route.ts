import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 直近の取り込みバッチ一覧（取り消し UI 用）
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  const orgId = await resolveOrgId(user.driverId);
  const { data } = await supabase
    .from("shift_import_batches")
    .select("id, sources, registered, reverted_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({ batches: data ?? [] });
}
