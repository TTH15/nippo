import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// DELETE: 拠点ピンを削除（自テナントのもののみ）。
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { error } = await supabase.from("map_places").delete().eq("id", id).eq("org_id", orgId);

  if (error) {
    console.error("[map/places] delete error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
