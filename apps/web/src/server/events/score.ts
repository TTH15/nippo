// ============================================================
// チーム戦（イベント）: 採点ロジック（純関数・Supabase非依存）
//   自動採点 = 承認済み日報の report_entries を採点ルールで集計。
//   手動加点 = event_point_entries(source='manual') を driver/team へ加算。
// 集計コア(src/server/aggregation)と同様、DBアクセスは呼び出し側で行い、
// ここは正規化済みデータを受け取って計算するだけ（check-event-scoring でユニットテスト）。
// ============================================================

import type {
  ScoringRuleSet,
  EventTeam,
  EventMember,
  ManualPointEntry,
  ScoringReport,
  DriverScore,
  TeamScore,
  EventScoreResult,
  RuleBreakdown,
} from "./types";

/** 承認済み・却下なしのみ採点対象（aggregation の isCountableReport と同条件） */
function isCountable(r: ScoringReport): boolean {
  return r.approvedAt != null && r.rejectedAt == null;
}

/**
 * 浮動小数の累積誤差を抑える（0.1+0.2=0.30000000000000004 等）。
 * 小数ポイントは許可だが実用上6桁で十分。表示崩れ・同点判定のズレを防ぐ。
 */
function roundPoints(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function fieldKeyOf(unitId: string, fieldKey: string): string {
  return `${unitId}|${fieldKey}`;
}

export type ComputeEventScoresInput = {
  scoringRule: ScoringRuleSet;
  teams: EventTeam[];
  members: EventMember[];
  reports: ScoringReport[];
  manualEntries: ManualPointEntry[];
};

export function computeEventScores(input: ComputeEventScoresInput): EventScoreResult {
  const { scoringRule, teams, members, reports, manualEntries } = input;

  // ルールごとの対象フィールド集合
  const ruleFieldSets = scoringRule.rules.map(
    (rule) => new Set(rule.fields.map((f) => fieldKeyOf(f.unitId, f.fieldKey))),
  );

  // driverId -> ruleIndex -> 数量合計
  const qtyByDriver = new Map<string, number[]>();
  const ensureQty = (driverId: string): number[] => {
    let arr = qtyByDriver.get(driverId);
    if (!arr) {
      arr = scoringRule.rules.map(() => 0);
      qtyByDriver.set(driverId, arr);
    }
    return arr;
  };

  for (const report of reports) {
    if (!isCountable(report)) continue;
    if (scoringRule.rules.length === 0) continue;
    const qty = ensureQty(report.driverId);
    for (const entry of report.entries) {
      const key = fieldKeyOf(entry.unitId, entry.fieldKey);
      for (let i = 0; i < ruleFieldSets.length; i++) {
        if (ruleFieldSets[i].has(key)) {
          qty[i] += entry.valueNum;
        }
      }
    }
  }

  // 手動ポイント集計
  const manualByDriver = new Map<string, number>();
  const manualByTeam = new Map<string, number>();
  for (const m of manualEntries) {
    const pts = Number(m.points) || 0;
    if (m.driverId) {
      manualByDriver.set(m.driverId, (manualByDriver.get(m.driverId) ?? 0) + pts);
    } else if (m.teamId) {
      manualByTeam.set(m.teamId, (manualByTeam.get(m.teamId) ?? 0) + pts);
    }
  }

  // メンバーの DriverScore を構築（メンバーのみ集計）
  const driverScores: DriverScore[] = members.map((member) => {
    const qty = qtyByDriver.get(member.driverId);
    const breakdown: RuleBreakdown[] = scoringRule.rules.map((rule, i) => {
      const quantity = qty ? qty[i] : 0;
      return {
        ruleId: rule.id,
        label: rule.label,
        quantity,
        points: roundPoints(rule.pointsPer * quantity),
      };
    });
    const autoPoints = roundPoints(breakdown.reduce((s, b) => s + b.points, 0));
    const manualPoints = roundPoints(manualByDriver.get(member.driverId) ?? 0);
    return {
      driverId: member.driverId,
      teamId: member.teamId,
      autoPoints,
      manualPoints,
      total: roundPoints(autoPoints + manualPoints),
      breakdown,
    };
  });

  const byTeam = new Map<string, DriverScore[]>();
  for (const ds of driverScores) {
    if (!ds.teamId) continue;
    const arr = byTeam.get(ds.teamId);
    if (arr) arr.push(ds);
    else byTeam.set(ds.teamId, [ds]);
  }

  const sortedTeams = [...teams].sort((a, b) => a.sortOrder - b.sortOrder);
  const sortOrderByTeam = new Map(sortedTeams.map((t) => [t.id, t.sortOrder]));
  const teamScores: TeamScore[] = sortedTeams.map((team) => {
    // メンバーは得点降順。同点はドライバーID昇順で決定的に（リロードしても不変）。
    const ms = (byTeam.get(team.id) ?? [])
      .slice()
      .sort((a, b) => b.total - a.total || a.driverId.localeCompare(b.driverId));
    const memberPoints = roundPoints(ms.reduce((s, m) => s + m.total, 0));
    const teamManualPoints = roundPoints(manualByTeam.get(team.id) ?? 0);
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      memberPoints,
      teamManualPoints,
      total: roundPoints(memberPoints + teamManualPoints),
      members: ms,
    };
  });
  // チームは得点降順。同点は sortOrder 昇順→teamId 昇順で決定的に。
  teamScores.sort(
    (a, b) =>
      b.total - a.total ||
      (sortOrderByTeam.get(a.teamId) ?? 0) - (sortOrderByTeam.get(b.teamId) ?? 0) ||
      a.teamId.localeCompare(b.teamId),
  );

  // 個人は得点降順。同点はドライバーID昇順で決定的に（members の取得順に依存しない）。
  const individuals = driverScores
    .slice()
    .sort((a, b) => b.total - a.total || a.driverId.localeCompare(b.driverId));

  return { teams: teamScores, individuals };
}
