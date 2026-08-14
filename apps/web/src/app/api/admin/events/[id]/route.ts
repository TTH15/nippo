import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { normalizeScoringRuleSet } from "@/server/events/types";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["draft", "active", "closed"]);

// GET: イベント詳細（teams / members / 採点UI用の drivers を同梱）。
// キャリア木はページ側が /api/admin/carriers（他画面と dedup が効く）で取得するため
// ここでは返さない（詳細を開くたびの二重ダウンロードを廃止・2026-08 監査）。
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_view_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const [
    { data: event, error: eErr },
    { data: teams, error: tErr },
    { data: members, error: mErr },
    { data: drivers, error: dErr },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, description, starts_on, ends_on, status, scoring_rule, created_at")
      .eq("id", id)
      .eq("org_id", orgId)
      .single(),
    supabase.from("event_teams").select("*").eq("event_id", id).order("sort_order"),
    supabase.from("event_team_members").select("id, team_id, driver_id").eq("event_id", id),
    supabase.from("drivers").select("id, name, display_name").eq("org_id", orgId).order("name"),
  ]);

  if (eErr || !event) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }
  if (tErr || mErr || dErr) {
    console.error(tErr || mErr || dErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({
    event: { ...event, scoring_rule: normalizeScoringRuleSet(event.scoring_rule) },
    teams: teams ?? [],
    members: members ?? [],
    drivers: drivers ?? [],
  });
}

// PATCH: イベント更新（名称/説明/期間/status/採点ルール）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "イベント名は必須です" }, { status: 400 });
    updates.name = name;
  }
  if (typeof body.description === "string") updates.description = body.description;
  if ("starts_on" in body) updates.starts_on = body.starts_on || null;
  if ("ends_on" in body) updates.ends_on = body.ends_on || null;
  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: "不正な status です" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if ("scoring_rule" in body) {
    updates.scoring_rule = normalizeScoringRuleSet(body.scoring_rule);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "更新内容がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("events")
    .update(updates)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id, name, description, starts_on, ends_on, status, scoring_rule, created_at")
    .single();

  if (error || !data) {
    console.error(error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({
    event: { ...data, scoring_rule: normalizeScoringRuleSet(data.scoring_rule) },
  });
}

// DELETE: イベント削除（FK CASCADE で teams/members/points も削除）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { error } = await supabase.from("events").delete().eq("id", id).eq("org_id", orgId);
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
