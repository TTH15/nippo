import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// DELETE: 手動ポイント削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const { id: eventId, entryId } = await params;

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
