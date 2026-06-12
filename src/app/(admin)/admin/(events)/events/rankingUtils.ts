import type { RankingResponse } from "./types";

// 浮動小数の累積誤差を抑える（サーバー側 score.ts の roundPoints と同方針）。
const roundPoints = (n: number): number => Math.round(n * 1e6) / 1e6;

export const medalForRank = (rank: number): string =>
  rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`;

// 同点は同順位（標準競技順位 1,1,3,…）
export function tieRanks(items: { total: number }[]): number[] {
  const ranks: number[] = [];
  items.forEach((it, i) => {
    if (i > 0 && it.total === items[i - 1].total) ranks.push(ranks[i - 1]);
    else ranks.push(i + 1);
  });
  return ranks;
}

// ランキングにポイント差分を即時反映（楽観的更新用）
export function applyPointDelta(
  ranking: RankingResponse,
  driverId: string | null,
  teamId: string | null,
  delta: number,
): RankingResponse {
  let individuals = ranking.individuals.map((d) =>
    driverId && d.driverId === driverId
      ? {
          ...d,
          manualPoints: roundPoints(d.manualPoints + delta),
          total: roundPoints(d.total + delta),
        }
      : d,
  );
  individuals = [...individuals].sort((a, b) => b.total - a.total);

  let teams = ranking.teams.map((t) => {
    if (teamId && t.teamId === teamId) {
      return {
        ...t,
        teamManualPoints: roundPoints(t.teamManualPoints + delta),
        total: roundPoints(t.total + delta),
      };
    }
    if (driverId) {
      const idx = t.members.findIndex((m) => m.driverId === driverId);
      if (idx >= 0) {
        const newMembers = t.members.map((m, i) =>
          i === idx
            ? {
                ...m,
                manualPoints: roundPoints(m.manualPoints + delta),
                total: roundPoints(m.total + delta),
              }
            : m,
        );
        return {
          ...t,
          members: [...newMembers].sort((a, b) => b.total - a.total),
          memberPoints: roundPoints(t.memberPoints + delta),
          total: roundPoints(t.total + delta),
        };
      }
    }
    return t;
  });
  teams = [...teams].sort((a, b) => b.total - a.total);

  return { ...ranking, teams, individuals };
}
