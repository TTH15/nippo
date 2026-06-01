import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { computeEventScores } from "@/server/events/score";
import { normalizeScoringRuleSet } from "@/server/events/types";
import type { EventTeam, EventMember, ManualPointEntry, ScoringReport } from "@/server/events/types";
import { loadSubmitScreenConfig } from "@/server/submitScreen/config";

export const dynamic = "force-dynamic";

// ============================================================
// ドライバーアプリのゲーミフィケーション用: 開催中チーム戦の自チーム状況。
//   - 自チームのポイント（順位は config.teamRankingVisibleToDrivers の時のみ全チーム返す）
//   - pendingBonus: 既読(last_bonus_seen_at)以降の正の手動加点（次回起動時に1回演出）
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  const config = await loadSubmitScreenConfig(supabase);
  const rankingVisible = config.teamRankingVisibleToDrivers;

  // 開催中(active)かつ期間内のチーム戦イベント
  const { data: ev } = await supabase
    .from("events")
    .select("id, name, starts_on, ends_on, scoring_rule")
    .eq("status", "active")
    .lte("starts_on", date)
    .gte("ends_on", date)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ev) {
    return NextResponse.json({ active: false, myTeam: null, rankingVisible, pendingBonus: null });
  }

  const [{ data: teamRows }, { data: memberRows }, { data: pointRows }] = await Promise.all([
    supabase.from("event_teams").select("id, name, color, sort_order").eq("event_id", ev.id).order("sort_order"),
    supabase.from("event_team_members").select("team_id, driver_id").eq("event_id", ev.id),
    supabase
      .from("event_point_entries")
      .select("team_id, driver_id, points, reason, entry_date")
      .eq("event_id", ev.id)
      .eq("source", "manual"),
  ]);

  const teams: EventTeam[] = (teamRows ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color, sortOrder: t.sort_order }));
  const members: EventMember[] = (memberRows ?? []).map((m) => ({ driverId: m.driver_id, teamId: m.team_id }));
  const manualEntries: ManualPointEntry[] = (pointRows ?? []).map((p) => ({
    teamId: p.team_id,
    driverId: p.driver_id,
    points: Number(p.points) || 0,
    reason: p.reason,
    entryDate: p.entry_date,
  }));

  const aggData = await loadAggregationData(supabase, ev.starts_on, ev.ends_on);
  const reports: ScoringReport[] = aggData.reports.map((r) => ({
    driverId: r.driverId,
    approvedAt: r.approvedAt,
    rejectedAt: r.rejectedAt,
    entries: r.entries.map((e) => ({ unitId: e.unitId, fieldKey: e.fieldKey, valueNum: e.valueNum })),
  }));
  const result = computeEventScores({ scoringRule: normalizeScoringRuleSet(ev.scoring_rule), teams, members, reports, manualEntries });

  const myTeamId = members.find((m) => m.driverId === driverId)?.teamId ?? null;
  const myTeamScore = myTeamId ? result.teams.find((t) => t.teamId === myTeamId) ?? null : null;
  const myTeam = myTeamScore
    ? { id: myTeamScore.teamId, name: myTeamScore.name, color: myTeamScore.color, points: myTeamScore.total }
    : null;

  // pendingBonus: 既読時刻より後の正の手動加点（自分宛）
  const { data: driverRow } = await supabase
    .from("drivers")
    .select("last_bonus_seen_at")
    .eq("id", driverId)
    .maybeSingle();
  const lastSeen = driverRow?.last_bonus_seen_at ? String(driverRow.last_bonus_seen_at) : null;

  let bonusQ = supabase
    .from("event_point_entries")
    .select("points, created_at")
    .eq("event_id", ev.id)
    .eq("source", "manual")
    .eq("driver_id", driverId)
    .gt("points", 0);
  if (lastSeen) bonusQ = bonusQ.gt("created_at", lastSeen);
  const { data: bonusRows } = await bonusQ;
  const bonusPoints = (bonusRows ?? []).reduce((s, r) => s + (Number(r.points) || 0), 0);
  const pendingBonus = bonusPoints > 0 ? { points: bonusPoints, count: (bonusRows ?? []).length } : null;

  // 同点は同順位（並びは score.ts で決定的に整列済み）
  const teamRanks: number[] = [];
  result.teams.forEach((t, i) =>
    teamRanks.push(i > 0 && t.total === result.teams[i - 1].total ? teamRanks[i - 1] : i + 1),
  );

  return NextResponse.json({
    active: true,
    eventName: ev.name,
    myTeam,
    rankingVisible,
    teams: rankingVisible
      ? result.teams.map((t, i) => ({ rank: teamRanks[i], teamId: t.teamId, name: t.name, color: t.color, total: t.total }))
      : undefined,
    pendingBonus,
  });
}
