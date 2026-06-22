import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { insertShiftRequestLogs, fetchActorName } from "@/server/shiftRequests/log";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // 削除前に対象行を取得し、変更履歴（運営による解除）を残す。
  const { data: target } = await supabase
    .from("shift_requests")
    .select("driver_id, request_date, slot_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("shift_requests").delete().eq("id", id);
  if (error) {
    console.error("[/api/admin/shifts/requests/[id]] DELETE error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (target) {
    const slotId = (target.slot_id as string | null) ?? null;
    let slotName: string | null = null;
    if (slotId) {
      const { data: slot } = await supabase
        .from("shift_request_slots")
        .select("name")
        .eq("id", slotId)
        .maybeSingle();
      slotName = (slot?.name as string | null) ?? null;
    }
    const actorName = await fetchActorName(user.driverId);
    await insertShiftRequestLogs([
      {
        driver_id: String(target.driver_id),
        request_date: String(target.request_date),
        slot_id: slotId,
        slot_name: slotName,
        action: "remove",
        actor_type: "admin",
        actor_id: user.driverId,
        actor_name: actorName,
      },
    ]);
  }

  return NextResponse.json({ ok: true });
}
