import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { eventBelongsToOrg } from "@/server/events/guard";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// DELETE: 手動ポイント削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const { id: eventId, entryId } = await params;
  const orgId = await resolveOrgId(user.driverId);
  if (!(await eventBelongsToOrg(eventId, orgId))) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId);
  if (!isUuid) {
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 400 });
  }

  const { error } = await supabase
    .from("event_point_entries")
    .delete()
    .eq("id", entryId)
    .eq("event_id", eventId)
    .eq("source", "manual");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
