import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// DELETE: 単回招待の失効（revoked_at を刻む）。org ガード。使用済みはそのまま（履歴保持）。
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_approve_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { data, error } = await supabase
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[admin/invites] revoke", error);
    return NextResponse.json({ error: "失効に失敗しました" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "対象が見つからない、または既に使用・失効済みです" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
