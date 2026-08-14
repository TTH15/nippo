"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrophy } from "@fortawesome/free-solid-svg-icons";
import { useTeamStatus } from "@/lib/components/TeamPointsBadge";

/**
 * /me 上部の自チームポイントカード。
 * 既定は自チームのポイントのみ。運営が順位公開ONなら全チーム順位も表示。
 * 取得は常設バッジと同一の SWR キーを共有（dedup で二重リクエストしない）。
 */
export function TeamPointsCard() {
  const { data: status } = useTeamStatus();

  if (!status?.active || !status.myTeam) return null;
  const t = status.myTeam;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <FontAwesomeIcon icon={faTrophy} className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-semibold text-slate-800">{status.eventName ?? "チーム戦"}</span>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block h-3.5 w-3.5 rounded-full shrink-0" style={{ background: t.color }} />
          <span className="font-semibold text-slate-800 truncate">{t.name}</span>
          <span className="text-[11px] text-slate-500 shrink-0">あなたのチーム</span>
        </div>
        <span className="text-xl font-extrabold text-slate-900 tabular-nums">{t.points.toLocaleString("ja-JP")} pt</span>
      </div>

      {status.rankingVisible && status.teams && status.teams.length > 0 && (
        <div className="mt-3 space-y-1">
          {status.teams.map((row) => (
            <div
              key={row.teamId}
              className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                row.teamId === t.id ? "bg-slate-100 ring-1 ring-slate-300" : "bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                    row.teamId === t.id ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {row.rank}
                </span>
                <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ background: row.color }} />
                <span className="font-medium text-slate-700 truncate">{row.name}</span>
              </div>
              <span className="font-bold tabular-nums text-slate-900">{row.total.toLocaleString("ja-JP")} pt</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
