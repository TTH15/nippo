import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { eventBelongsToOrg } from "@/server/events/guard";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PATCH: チーム更新（名前/色/並び）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const { id: eventId, teamId } = await params;
  const orgId = await resolveOrgId(user.driverId);
  if (!(await eventBelongsToOrg(eventId, orgId))) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "チーム名は必須です" }, { status: 400 });
    updates.name = name;
  }
  if (typeof body.color === "string" && body.color) updates.color = body.color;
  if (Number.isFinite(Number(body.sort_order))) updates.sort_order = Number(body.sort_order);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "更新内容がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("event_teams")
    .update(updates)
    .eq("id", teamId)
    .eq("event_id", eventId)
    .select("*")
    .single();

  if (error || !data) {
    console.error(error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ team: data });
}

// DELETE: チーム削除（メンバーは CASCADE、points.team_id は SET NULL）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const { id: eventId, teamId } = await params;
  const orgId = await resolveOrgId(user.driverId);
  if (!(await eventBelongsToOrg(eventId, orgId))) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  const { error } = await supabase
    .from("event_teams")
    .delete()
    .eq("id", teamId)
    .eq("event_id", eventId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
