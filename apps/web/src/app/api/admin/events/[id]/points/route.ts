import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { eventBelongsToOrg } from "@/server/events/guard";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 手動ポイント一覧（source='manual'）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_view_org_settings");
  if (isAuthError(user)) return user;
  const { id: eventId } = await params;
  const orgId = await resolveOrgId(user.driverId);
  if (!(await eventBelongsToOrg(eventId, orgId))) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("event_point_entries")
    .select("id, team_id, driver_id, entry_date, points, reason, source, created_at")
    .eq("event_id", eventId)
    .eq("source", "manual")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ entries: data ?? [] });
}

// POST: 手動ポイント追加（個人 or チーム）
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
  const driverId = typeof body.driverId === "string" && body.driverId ? body.driverId : null;
  const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
  const points = Number(body.points);

  if (!driverId && !teamId) {
    return NextResponse.json({ error: "対象（個人またはチーム）を指定してください" }, { status: 400 });
  }
  if (!Number.isFinite(points) || points === 0) {
    return NextResponse.json({ error: "ポイントは 0 以外の数値で指定してください" }, { status: 400 });
  }

  const insertRow = {
    event_id: eventId,
    // 個人指定が優先（その場合 team は所属から導出するため null のまま）
    team_id: driverId ? null : teamId,
    driver_id: driverId,
    entry_date: body.entry_date || null,
    points,
    reason: typeof body.reason === "string" ? body.reason : null,
    source: "manual" as const,
  };

  const { data, error } = await supabase
    .from("event_point_entries")
    .insert(insertRow)
    .select("id, team_id, driver_id, entry_date, points, reason, source, created_at")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "追加に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
}
