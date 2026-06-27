import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: ドライバーをチームへ割当（移動も兼ねる。1イベント1ドライバー1チーム）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const { id: eventId } = await params;

  const body = await req.json().catch(() => ({}));
  const driverId = typeof body.driverId === "string" ? body.driverId : "";
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  if (!driverId || !teamId) {
    return NextResponse.json({ error: "driverId と teamId は必須です" }, { status: 400 });
  }

  // UNIQUE(event_id, driver_id) で移動（再割当）も upsert で吸収
  const { data, error } = await supabase
    .from("event_team_members")
    .upsert(
      { event_id: eventId, team_id: teamId, driver_id: driverId },
      { onConflict: "event_id,driver_id" },
    )
    .select("id, team_id, driver_id")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "割当に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ member: data });
}

// DELETE: ドライバーをイベントのチームから外す
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const { id: eventId } = await params;

  const body = await req.json().catch(() => ({}));
  const driverId = typeof body.driverId === "string" ? body.driverId : "";
  if (!driverId) {
    return NextResponse.json({ error: "driverId は必須です" }, { status: 400 });
  }

  const { error } = await supabase
    .from("event_team_members")
    .delete()
    .eq("event_id", eventId)
    .eq("driver_id", driverId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "解除に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
