import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAggregationData } from "@/server/aggregation/load";
import { isCountableReport } from "@/server/aggregation/compute";
import { computeEventScores } from "@/server/events/score";
import { normalizeScoringRuleSet } from "@/server/events/types";
import type { EventTeam, EventMember, ManualPointEntry, ScoringReport } from "@/server/events/types";
import { getDisplayName } from "@/lib/displayName";
import type { SubmitScreenConfig, MetricField } from "./config";
import type {
  SubmitBlock,
  EventPointsBlock,
  PersonalFilter,
  ResolvedBlock,
} from "@/lib/submitScreenBlocks";

export type { SubmitBlock, ResolvedBlock } from "@/lib/submitScreenBlocks";

// ============================================================
// 送信後画面の「ブロック」リゾルバ。
//   設定ブロック(SubmitBlock) → ドライバー向けに解決(ResolvedBlock)。
//   型は @/lib/submitScreenBlocks（クライアント共有）に定義。
// ============================================================

const arr = <T,>(v: unknown, map: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.map(map).filter((x): x is T => x !== null) : [];

function normMetricFields(raw: unknown): MetricField[] {
  return arr(raw, (f) =>
    f && typeof (f as MetricField).unitId === "string" && typeof (f as MetricField).fieldKey === "string"
      ? { unitId: (f as MetricField).unitId, fieldKey: (f as MetricField).fieldKey }
      : null,
  );
}
const normStrs = (raw: unknown): string[] => arr(raw, (x) => (typeof x === "string" ? x : null));

/** 保存された jsonb を SubmitBlock[] に正規化（不正は捨てる）。 */
export function normalizeBlocks(raw: unknown): SubmitBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: SubmitBlock[] = [];
  raw.forEach((b, i) => {
    if (!b || typeof b !== "object") return;
    const o = b as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id ? o.id : `b${i}`;
    const enabled = o.enabled !== false;
    switch (o.type) {
      case "greeting":
        out.push({ id, type: "greeting", enabled, title: String(o.title ?? ""), message: String(o.message ?? "") });
        break;
      case "today_reward":
        out.push({ id, type: "today_reward", enabled });
        break;
      case "event_points":
        out.push({
          id,
          type: "event_points",
          enabled,
          source: o.source === "event" ? "event" : "auto",
          eventId: typeof o.eventId === "string" && o.eventId ? o.eventId : null,
          showRanking: o.showRanking === true,
        });
        break;
      case "personal_count":
      case "personal_ranking":
        out.push({
          id,
          type: o.type,
          enabled,
          label: String(o.label ?? (o.type === "personal_count" ? "今月の個数" : "個人ランキング")),
          metricFields: normMetricFields(o.metricFields),
          carrierIds: normStrs(o.carrierIds),
          targetDriverIds: normStrs(o.targetDriverIds),
        });
        break;
      default:
        break;
    }
  });
  return out;
}

/** blocks 未設定（null）のとき、従来のフラット設定から既定ブロックを導出。 */
export function defaultBlocksFromConfig(config: SubmitScreenConfig): SubmitBlock[] {
  const blocks: SubmitBlock[] = [
    { id: "greeting", type: "greeting", enabled: true, title: config.thanksTitle, message: config.thanksMessage },
    { id: "today_reward", type: "today_reward", enabled: true },
  ];
  const wantsEvent = config.rankingSource === "auto" || config.rankingSource === "event";
  const wantsPersonal = config.rankingSource === "auto" || config.rankingSource === "individual";
  if (wantsEvent) {
    blocks.push({
      id: "event_points",
      type: "event_points",
      enabled: true,
      source: config.rankingSource === "event" ? "event" : "auto",
      eventId: config.linkedEventId,
      showRanking: config.teamRankingVisibleToDrivers,
    });
  }
  if (wantsPersonal) {
    blocks.push({
      id: "personal_ranking",
      type: "personal_ranking",
      enabled: true,
      label: config.metricLabel,
      metricFields: config.metricFields,
      carrierIds: [],
      targetDriverIds: config.targetDriverIds,
    });
  }
  return blocks;
}

function monthRange(dateStr: string) {
  const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

const tieRanks = (items: { total: number }[]): number[] => {
  const ranks: number[] = [];
  items.forEach((it, i) => ranks.push(i > 0 && it.total === items[i - 1].total ? ranks[i - 1] : i + 1));
  return ranks;
};

type EvRow = {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  scoring_rule: unknown;
  team_ranking_visible_to_drivers?: boolean;
};
const EV_COLS = "id, name, starts_on, ends_on, scoring_rule, team_ranking_visible_to_drivers";

async function pickEvent(
  supabase: SupabaseClient,
  orgId: string,
  block: EventPointsBlock,
  date: string,
): Promise<EvRow | null> {
  if (block.source === "event") {
    if (!block.eventId) return null;
    // eventId は自社の設定由来だが、設定が古い/不正な場合に他社イベントを引かないよう org も絞る
    const { data } = await supabase
      .from("events")
      .select(EV_COLS)
      .eq("id", block.eventId)
      .eq("org_id", orgId)
      .maybeSingle();
    return data && data.starts_on && data.ends_on ? (data as EvRow) : null;
  }
  const { data } = await supabase
    .from("events")
    .select(EV_COLS)
    // 自動選択（開催中）。org を絞らないと他社の開催中イベントを拾ってしまう
    .eq("org_id", orgId)
    .eq("status", "active")
    .lte("starts_on", date)
    .gte("ends_on", date)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as EvRow) ?? null;
}

export type ResolveContext = {
  orgId: string;
  driverId: string;
  date: string;
  todayReward: number;
};

/** ブロック設定をドライバー向けに解決する。 */
export async function resolveBlocks(
  supabase: SupabaseClient,
  blocks: SubmitBlock[],
  ctx: ResolveContext,
): Promise<ResolvedBlock[]> {
  const out: ResolvedBlock[] = [];

  // 個人系で使う今月の集計（必要時のみ1回ロード）。
  let monthDataPromise: ReturnType<typeof loadAggregationData> | null = null;
  const month = monthRange(ctx.date);
  const monthData = () => (monthDataPromise ??= loadAggregationData(supabase, ctx.orgId, month.start, month.end));
  let driverNamesPromise: Promise<Map<string, string>> | null = null;
  const driverNames = () => {
    if (!driverNamesPromise) {
      driverNamesPromise = (async () => {
        // ランキング表示名。自社ドライバーのみ（他社の氏名を読み込まない）
        const { data } = await supabase
          .from("drivers")
          .select("id, name, display_name")
          .eq("org_id", ctx.orgId);
        return new Map<string, string>((data ?? []).map((d) => [d.id, getDisplayName(d)]));
      })();
    }
    return driverNamesPromise;
  };

  for (const b of blocks) {
    if (!b.enabled) continue;
    if (b.type === "greeting") {
      out.push({ id: b.id, type: "greeting", title: b.title, message: b.message });
    } else if (b.type === "today_reward") {
      out.push({ id: b.id, type: "today_reward", todayReward: ctx.todayReward });
    } else if (b.type === "event_points") {
      const resolved = await resolveEventBlock(supabase, b, ctx);
      if (resolved) out.push(resolved);
    } else if (b.type === "personal_count") {
      // 対象ドライバー指定がある場合、含まれない人にはブロック自体を出さない（空=全員）。
      if (b.targetDriverIds.length > 0 && !b.targetDriverIds.includes(ctx.driverId)) continue;
      const data = await monthData();
      const value = sumMyMetrics(data, ctx.driverId, b);
      out.push({ id: b.id, type: "personal_count", label: b.label, value });
    } else if (b.type === "personal_ranking") {
      // 対象ドライバー指定がある場合、含まれない人にはブロック自体を出さない（空=全員）。
      if (b.targetDriverIds.length > 0 && !b.targetDriverIds.includes(ctx.driverId)) continue;
      const data = await monthData();
      const names = await driverNames();
      out.push({ id: b.id, type: "personal_ranking", label: b.label, ...computePersonalRanking(data, b, ctx.driverId, names) });
    }
  }
  return out;
}

async function resolveEventBlock(
  supabase: SupabaseClient,
  block: EventPointsBlock,
  ctx: ResolveContext,
): Promise<Extract<ResolvedBlock, { type: "event_points" }> | null> {
  const ev = await pickEvent(supabase, ctx.orgId, block, ctx.date);
  if (!ev || !ev.starts_on || !ev.ends_on) return null;

  const [{ data: teamRows }, { data: memberRows }, { data: pointRows }, { data: drv }] = await Promise.all([
    supabase.from("event_teams").select("id, name, color, sort_order").eq("event_id", ev.id).order("sort_order"),
    supabase.from("event_team_members").select("team_id, driver_id").eq("event_id", ev.id),
    supabase.from("event_point_entries").select("team_id, driver_id, points, reason, entry_date").eq("event_id", ev.id).eq("source", "manual"),
    // 個人ランキングの表示名。自社ドライバーのみ
    supabase.from("drivers").select("id, name, display_name").eq("org_id", ctx.orgId),
  ]);
  const teams: EventTeam[] = (teamRows ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color, sortOrder: t.sort_order }));
  const members: EventMember[] = (memberRows ?? []).map((m) => ({ driverId: m.driver_id, teamId: m.team_id }));
  // イベントのチーム未所属者にはブロック自体を出さない（重い集計の前に早期判定）。
  const myTeamId = members.find((m) => m.driverId === ctx.driverId)?.teamId ?? null;
  if (!myTeamId) return null;
  const manualEntries: ManualPointEntry[] = (pointRows ?? []).map((p) => ({ teamId: p.team_id, driverId: p.driver_id, points: Number(p.points) || 0, reason: p.reason, entryDate: p.entry_date }));
  const aggData = await loadAggregationData(supabase, ctx.orgId, ev.starts_on, ev.ends_on);
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
  const myTeamScore = result.teams.find((t) => t.teamId === myTeamId) ?? null;

  // 当日の自分の日報を採点ルールでスコア化＝今日の獲得ポイント（カウントアップ用）。
  let todayPoints = 0;
  const dayData = await loadAggregationData(supabase, ctx.orgId, ctx.date, ctx.date);
  const ruleFieldSets = rule.rules.map((r) => new Set(r.fields.map((f) => `${f.unitId}|${f.fieldKey}`)));
  for (const r of dayData.reports) {
    if (r.driverId !== ctx.driverId || r.reportDate !== ctx.date || r.rejectedAt) continue;
    for (const e of r.entries) {
      const key = `${e.unitId}|${e.fieldKey}`;
      rule.rules.forEach((rl, i) => {
        if (ruleFieldSets[i].has(key)) todayPoints += (e.valueNum ?? 0) * rl.pointsPer;
      });
    }
  }

  const visible =
    typeof ev.team_ranking_visible_to_drivers === "boolean" ? ev.team_ranking_visible_to_drivers : false;
  const rankingVisible = block.showRanking && visible;
  const topIndividuals = result.individuals.slice(0, 10);
  const teamRanks = tieRanks(result.teams);
  const indivRanks = tieRanks(topIndividuals);

  return {
    id: block.id,
    type: "event_points",
    eventName: ev.name,
    myTeamId,
    myTeam: myTeamScore ? { id: myTeamScore.teamId, name: myTeamScore.name, color: myTeamScore.color, total: myTeamScore.total } : null,
    todayPoints,
    showRanking: block.showRanking,
    rankingVisible,
    teams: rankingVisible ? result.teams.map((t, i) => ({ rank: teamRanks[i], teamId: t.teamId, name: t.name, color: t.color, total: t.total })) : [],
    individuals: rankingVisible ? topIndividuals.map((d, i) => ({ rank: indivRanks[i], name: nameById.get(d.driverId) ?? "—", total: d.total, isMe: d.driverId === ctx.driverId })) : [],
  };
}

type MonthData = Awaited<ReturnType<typeof loadAggregationData>>;

/** 本人の今月の指標合計（キャリアフィルタ適用）。 */
function sumMyMetrics(data: MonthData, driverId: string, filter: PersonalFilter): number {
  const fieldSet = new Set(filter.metricFields.map((f) => `${f.unitId}|${f.fieldKey}`));
  if (fieldSet.size === 0) return 0;
  const carrierSet = new Set(filter.carrierIds);
  let v = 0;
  for (const r of data.reports) {
    if (r.driverId !== driverId) continue;
    if (!isCountableReport(r)) continue;
    if (carrierSet.size > 0 && !(r.carrierId && carrierSet.has(r.carrierId))) continue;
    for (const e of r.entries) {
      if (fieldSet.has(`${e.unitId}|${e.fieldKey}`)) v += e.valueNum ?? 0;
    }
  }
  return v;
}

function computePersonalRanking(
  data: MonthData,
  filter: PersonalFilter & { label: string },
  driverId: string,
  names: Map<string, string>,
): { configured: boolean; ranking: { rank: number; name: string; value: number; isMe: boolean }[]; myRank: { rank: number; name: string; value: number; isMe: boolean } | null; total: number } {
  const fieldSet = new Set(filter.metricFields.map((f) => `${f.unitId}|${f.fieldKey}`));
  const targetSet = new Set(filter.targetDriverIds);
  const carrierSet = new Set(filter.carrierIds);
  const byDriver = new Map<string, number>();
  if (fieldSet.size > 0) {
    for (const r of data.reports) {
      if (!isCountableReport(r)) continue;
      if (targetSet.size > 0 && !targetSet.has(r.driverId)) continue;
      if (carrierSet.size > 0 && !(r.carrierId && carrierSet.has(r.carrierId))) continue;
      let v = byDriver.get(r.driverId) ?? 0;
      for (const e of r.entries) {
        if (fieldSet.has(`${e.unitId}|${e.fieldKey}`)) v += e.valueNum ?? 0;
      }
      byDriver.set(r.driverId, v);
    }
  }
  const ordered = [...byDriver.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sorted = ordered.map(([id, value], i) => ({
    rank: i > 0 && value === ordered[i - 1][1] ? -1 : i + 1,
    name: names.get(id) ?? "—",
    value,
    isMe: id === driverId,
  }));
  for (let i = 1; i < sorted.length; i++) if (sorted[i].rank === -1) sorted[i].rank = sorted[i - 1].rank;
  const myRank = sorted.find((x) => x.isMe) ?? null;
  return { configured: fieldSet.size > 0, ranking: sorted.slice(0, 10), myRank, total: sorted.length };
}
