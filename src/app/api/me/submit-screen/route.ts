import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAggregationData } from "@/server/aggregation/load";
import { isCountableReport } from "@/server/aggregation/compute";
import { computeEventScores } from "@/server/events/score";
import { normalizeScoringRuleSet } from "@/server/events/types";
import type { EventTeam, EventMember, ManualPointEntry, ScoringReport } from "@/server/events/types";
import { loadSubmitScreenConfig } from "@/server/submitScreen/config";
import { loadDriverLease, loadCourseDailyLease, leaseDailyRateForCourse } from "@/server/billing/driverLease";
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
  // リース控除（DAILY のみ日当に反映）。当日コースの日額リース代(courses.daily_lease)を1回控除。
  const [lease, courseDailyLease] = await Promise.all([
    loadDriverLease(supabase, driverId, date, date),
    loadCourseDailyLease(supabase),
  ]);

  let todayReward = 0;
  let leaseToday = 0; // 当日コースの最大日額（DAILY時）
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
    leaseToday = Math.max(leaseToday, leaseDailyRateForCourse(lease, r.courseId, courseDailyLease));
  }
  todayReward -= leaseToday;

  // --- ランキング ---
  let ranking: unknown = null;
  let todayPoints = 0; // 当日の自分の日報で獲得した採点ポイント（カウントアップ用）
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
      const rule = normalizeScoringRuleSet(ev.scoring_rule);
      const result = computeEventScores({ scoringRule: rule, teams, members, reports, manualEntries });
      const nameById = new Map<string, string>();
      (drv ?? []).forEach((d) => nameById.set(d.id, getDisplayName(d)));
      const myTeamId = members.find((m) => m.driverId === driverId)?.teamId ?? null;
      const myTeamScore = myTeamId ? result.teams.find((t) => t.teamId === myTeamId) ?? null : null;
      const myTeam = myTeamScore
        ? { id: myTeamScore.teamId, name: myTeamScore.name, color: myTeamScore.color, total: myTeamScore.total }
        : null;

      // 当日の自分の日報（未承認含む・却下除外）を採点ルールでスコア化＝今日獲得ポイント
      const ruleFieldSets = rule.rules.map((r) => new Set(r.fields.map((f) => `${f.unitId}|${f.fieldKey}`)));
      for (const r of dayData.reports) {
        if (r.driverId !== driverId || r.reportDate !== date || r.rejectedAt) continue;
        for (const e of r.entries) {
          const key = `${e.unitId}|${e.fieldKey}`;
          rule.rules.forEach((rl, i) => {
            if (ruleFieldSets[i].has(key)) todayPoints += (e.valueNum ?? 0) * rl.pointsPer;
          });
        }
      }

      const rankingVisible = config.teamRankingVisibleToDrivers;
      // 同点は同順位（並びは score.ts 側で決定的に整列済み）
      const tieRanks = (items: { total: number }[]): number[] => {
        const ranks: number[] = [];
        items.forEach((it, i) => ranks.push(i > 0 && it.total === items[i - 1].total ? ranks[i - 1] : i + 1));
        return ranks;
      };
      const topIndividuals = result.individuals.slice(0, 10);
      const teamRanks = tieRanks(result.teams);
      const indivRanks = tieRanks(topIndividuals);
      ranking = {
        mode: "team",
        eventName: ev.name,
        myTeamId,
        myTeam,
        rankingVisible,
        // 順位非公開なら順位/他チーム/個人MVPは返さない（自チームポイントのみ）
        teams: rankingVisible
          ? result.teams.map((t, i) => ({ rank: teamRanks[i], teamId: t.teamId, name: t.name, color: t.color, total: t.total }))
          : [],
        individuals: rankingVisible
          ? topIndividuals.map((d, i) => ({ rank: indivRanks[i], name: nameById.get(d.driverId) ?? "—", total: d.total, isMe: d.driverId === driverId }))
          : [],
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
      // 得点降順、同点は driverId 昇順で決定的に整列 → 同点は同順位を付与
      const ordered = [...byDriver.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const sorted = ordered.map(([id, value], i) => ({
        rank: i > 0 && value === ordered[i - 1][1] ? -1 : i + 1, // 後で前順位に揃える
        name: nameById.get(id) ?? "—",
        value,
        isMe: id === driverId,
      }));
      // 同点を前の順位へ揃える
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].rank === -1) sorted[i].rank = sorted[i - 1].rank;
      }
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

  return NextResponse.json({ date, todayReward: Math.round(todayReward), leaseToday, todayPoints, ranking });
}
