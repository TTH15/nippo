import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { eventBelongsToOrg } from "@/server/events/guard";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: チーム追加
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const { id: eventId } = await params;
  const orgId = await resolveOrgId(user.driverId);
  if (!(await eventBelongsToOrg(eventId, orgId))) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "チーム名は必須です" }, { status: 400 });
  }
  const color = typeof body.color === "string" && body.color ? body.color : "#3b82f6";

  const { data: maxRow } = await supabase
    .from("event_teams")
    .select("sort_order")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("event_teams")
    .insert({ event_id: eventId, name, color, sort_order: sortOrder })
    .select("*")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ team: data });
}
