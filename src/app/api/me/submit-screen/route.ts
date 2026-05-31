import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { isCountableReport } from "@/server/aggregation/compute";
import { computeEventScores } from "@/server/events/score";
import { normalizeScoringRuleSet } from "@/server/events/types";
import type { EventTeam, EventMember, ManualPointEntry, ScoringReport } from "@/server/events/types";
import { loadSubmitScreenConfig } from "@/server/submitScreen/config";
import { getDisplayName } from "@/lib/displayName";

export const dynamic = "force-dynamic";

function monthRange(dateStr: string) {
  const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  const config = await loadSubmitScreenConfig(supabase);

  // --- 今日の報酬見込み（v2・未承認も含む / 却下は除外） ---
  const dayData = await loadAggregationData(supabase, date, date);
  const unitById = new Map(dayData.units.map((u) => [u.id, u]));
  const rateByCourseUnit = new Map(dayData.unitRates.map((r) => [`${r.courseId}:${r.unitId}`, r]));
  const fixedByCourse = new Map(dayData.fixedRates.map((r) => [r.courseId, r]));
  let todayReward = 0;
  for (const r of dayData.reports) {
    if (r.driverId !== driverId || r.reportDate !== date || r.rejectedAt) continue;
    if (!r.courseId) continue;
    for (const e of r.entries) {
      const unit = unitById.get(e.unitId);
      const billable = unit?.fields.find((x) => x.fieldKey === e.fieldKey)?.isBillable;
      if (!billable) continue;
      const rate = rateByCourseUnit.get(`${r.courseId}:${e.unitId}`);
      if (rate) todayReward += (e.valueNum ?? 0) * rate.payoutPerUnit;
    }
    const fx = fixedByCourse.get(r.courseId);
    if (fx && (fx.fixedRevenue !== 0 || fx.fixedProfit !== 0 || fx.fixedPayout !== 0)) {
      todayReward += fx.fixedPayout;
    }
  }

  // --- ランキング ---
  let ranking: unknown = null;
  if (config.showRanking) {
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

    if (ev) {
      // チーム戦ランキング
      const [{ data: teamRows }, { data: memberRows }, { data: pointRows }, { data: drv }] =
        await Promise.all([
          supabase.from("event_teams").select("id, name, color, sort_order").eq("event_id", ev.id).order("sort_order"),
          supabase.from("event_team_members").select("team_id, driver_id").eq("event_id", ev.id),
          supabase.from("event_point_entries").select("team_id, driver_id, points, reason, entry_date").eq("event_id", ev.id).eq("source", "manual"),
          supabase.from("drivers").select("id, name, display_name"),
        ]);
      const teams: EventTeam[] = (teamRows ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color, sortOrder: t.sort_order }));
      const members: EventMember[] = (memberRows ?? []).map((m) => ({ driverId: m.driver_id, teamId: m.team_id }));
      const manualEntries: ManualPointEntry[] = (pointRows ?? []).map((p) => ({ teamId: p.team_id, driverId: p.driver_id, points: Number(p.points) || 0, reason: p.reason, entryDate: p.entry_date }));
      const aggData = await loadAggregationData(supabase, ev.starts_on, ev.ends_on);
      const reports: ScoringReport[] = aggData.reports.map((r) => ({
        driverId: r.driverId,
        approvedAt: r.approvedAt,
        rejectedAt: r.rejectedAt,
        entries: r.entries.map((e) => ({ unitId: e.unitId, fieldKey: e.fieldKey, valueNum: e.valueNum })),
      }));
      const result = computeEventScores({ scoringRule: normalizeScoringRuleSet(ev.scoring_rule), teams, members, reports, manualEntries });
      const nameById = new Map<string, string>();
      (drv ?? []).forEach((d) => nameById.set(d.id, getDisplayName(d)));
      const myTeamId = members.find((m) => m.driverId === driverId)?.teamId ?? null;
      ranking = {
        mode: "team",
        eventName: ev.name,
        myTeamId,
        teams: result.teams.map((t, i) => ({ rank: i + 1, teamId: t.teamId, name: t.name, color: t.color, total: t.total })),
        individuals: result.individuals.slice(0, 10).map((d, i) => ({ rank: i + 1, name: nameById.get(d.driverId) ?? "—", total: d.total, isMe: d.driverId === driverId })),
      };
    } else {
      // 個人ランキング（運営設定の指標・対象・今月）
      const { start, end } = monthRange(date);
      const monthData = await loadAggregationData(supabase, start, end);
      const fieldSet = new Set(config.metricFields.map((f) => `${f.unitId}|${f.fieldKey}`));
      const targetSet = new Set(config.targetDriverIds);
      const byDriver = new Map<string, number>();
      if (fieldSet.size > 0) {
        for (const r of monthData.reports) {
          if (!isCountableReport(r)) continue;
          if (targetSet.size > 0 && !targetSet.has(r.driverId)) continue;
          let v = byDriver.get(r.driverId) ?? 0;
          for (const e of r.entries) {
            if (fieldSet.has(`${e.unitId}|${e.fieldKey}`)) v += e.valueNum ?? 0;
          }
          byDriver.set(r.driverId, v);
        }
      }
      const { data: drv } = await supabase.from("drivers").select("id, name, display_name");
      const nameById = new Map<string, string>();
      (drv ?? []).forEach((d) => nameById.set(d.id, getDisplayName(d)));
      // 対象に自分が含まれない場合でも自分の値は出す
      if (targetSet.size > 0 && !targetSet.has(driverId)) {
        // 自分が対象外なら除外（ランキングに出さない）
      }
      const sorted = [...byDriver.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, value], i) => ({ rank: i + 1, name: nameById.get(id) ?? "—", value, isMe: id === driverId }));
      const myRank = sorted.find((x) => x.isMe) ?? null;
      ranking = {
        mode: "personal",
        metricLabel: config.metricLabel,
        ranking: sorted.slice(0, 10),
        myRank,
        total: sorted.length,
        configured: fieldSet.size > 0,
      };
    }
  }

  return NextResponse.json({ date, todayReward: Math.round(todayReward), ranking });
}
