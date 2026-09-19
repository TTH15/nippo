import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { belongsToOrg } from "@/server/db/adminResourceScope";
import { insertShiftRequestLogs, fetchActorName } from "@/server/shiftRequests/log";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const orgId = user.orgId;

  // 削除前に対象行を取得し、変更履歴（運営による解除）を残す。
  const { data: target } = await supabase
    // tenant-scope-ok: id で1行に特定し、直後に belongsToOrg で自社のドライバーか確かめる
    .from("shift_requests")
    .select("driver_id, request_date, slot_id")
    .eq("id", id)
    .maybeSingle();

  // ★自社のドライバーの希望休だけを消せるようにする。org_id（migration 174）は
  //   移行中で NULL の行もありうるので、所属の判定は drivers 側で行う。
  if (!target) return NextResponse.json({ error: "対象の希望休が見つかりません。" }, { status: 404 });
  if (!orgId || !(await belongsToOrg("drivers", String(target.driver_id), orgId))) {
    return NextResponse.json({ error: "対象の希望休が見つかりません。" }, { status: 404 });
  }

  // tenant-scope-ok: 直上の belongsToOrg で自社のドライバーの行と確認済みの id
  const { error } = await supabase.from("shift_requests").delete().eq("id", id);
  if (error) {
    console.error("[/api/admin/shifts/requests/[id]] DELETE error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  {
    const slotId = (target.slot_id as string | null) ?? null;
    let slotName: string | null = null;
    if (slotId) {
      const { data: slot } = await supabase
        // tenant-scope-ok: 便は共有マスタ。元請→下請へ設定が伝わる構造を保つため全社で見える（編集は owner_org_id の会社だけ）。削除した希望休の便名スナップショットを取るだけ
        .from("shift_request_slots")
        .select("name")
        .eq("id", slotId)
        .maybeSingle();
      slotName = (slot?.name as string | null) ?? null;
    }
    const actorName = await fetchActorName(user.driverId);
    await insertShiftRequestLogs([
      {
        org_id: orgId,
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
