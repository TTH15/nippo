import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { computeEventScores } from "@/server/events/score";
import { normalizeScoringRuleSet } from "@/server/events/types";
import type {
  EventTeam,
  EventMember,
  ManualPointEntry,
  ScoringReport,
} from "@/server/events/types";
import { getDisplayName } from "@/lib/displayName";

export const dynamic = "force-dynamic";

// GET: ランキング（期間内の日報を採点ルールでライブ計算 + 手動加点）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: eventId } = await params;

  const { data: event, error: eErr } = await supabase
    .from("events")
    .select("id, starts_on, ends_on, scoring_rule")
    .eq("id", eventId)
    .single();
  if (eErr || !event) {
    return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
  }
  if (!event.starts_on || !event.ends_on) {
    return NextResponse.json(
      { error: "期間（開始日・終了日）を設定してください", needsPeriod: true },
      { status: 400 },
    );
  }

  const [
    { data: teamRows, error: tErr },
    { data: memberRows, error: mErr },
    { data: pointRows, error: pErr },
    { data: driverRows, error: dErr },
  ] = await Promise.all([
    supabase.from("event_teams").select("id, name, color, sort_order").eq("event_id", eventId).order("sort_order"),
    supabase.from("event_team_members").select("team_id, driver_id").eq("event_id", eventId),
    supabase
      .from("event_point_entries")
      .select("team_id, driver_id, points, reason, entry_date")
      .eq("event_id", eventId)
      .eq("source", "manual"),
    supabase.from("drivers").select("id, name, display_name"),
  ]);

  if (tErr || mErr || pErr || dErr) {
    console.error(tErr || mErr || pErr || dErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const teams: EventTeam[] = (teamRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    sortOrder: t.sort_order,
  }));
  const members: EventMember[] = (memberRows ?? []).map((m) => ({
    driverId: m.driver_id,
    teamId: m.team_id,
  }));
  const manualEntries: ManualPointEntry[] = (pointRows ?? []).map((p) => ({
    teamId: p.team_id,
    driverId: p.driver_id,
    points: Number(p.points) || 0,
    reason: p.reason,
    entryDate: p.entry_date,
  }));

  // 期間内の日報を集計コアでロード → ScoringReport へ
  const aggData = await loadAggregationData(supabase, orgId, event.starts_on, event.ends_on);
  const reports: ScoringReport[] = aggData.reports.map((r) => ({
    driverId: r.driverId,
    approvedAt: r.approvedAt,
    rejectedAt: r.rejectedAt,
    entries: r.entries.map((e) => ({
      unitId: e.unitId,
      fieldKey: e.fieldKey,
      valueNum: e.valueNum,
    })),
  }));

  const result = computeEventScores({
    scoringRule: normalizeScoringRuleSet(event.scoring_rule),
    teams,
    members,
    reports,
    manualEntries,
  });

  const driverNames: Record<string, string> = {};
  for (const d of driverRows ?? []) {
    driverNames[d.id] = getDisplayName(d);
  }

  return NextResponse.json({ ...result, driverNames });
}
