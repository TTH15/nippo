"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faTrophy, faChartColumn } from "@fortawesome/free-solid-svg-icons";
import { CountUp, easeWave } from "@/lib/components/CountUp";

// ============================================================
// 日報送信後の画面（個数の報告後に見える画面）。
//   今日の報酬見込み＋チーム累計ポイント（今日のぶん膨張）＋ランキング/個人ランキング。
//   本番（SubmitPageClientV2）と /preview/post-submit で共用する。
// ============================================================

export type PersonalRanking = {
  mode: "personal";
  metricLabel: string;
  ranking: { rank: number; name: string; value: number; isMe: boolean }[];
  myRank: { rank: number; name: string; value: number; isMe: boolean } | null;
  total: number;
  configured: boolean;
};
export type TeamRanking = {
  mode: "team";
  eventName: string;
  myTeamId: string | null;
  myTeam?: { id: string; name: string; color: string; total: number } | null;
  rankingVisible?: boolean;
  teams: { rank: number; teamId: string; name: string; color: string; total: number }[];
  individuals: { rank: number; name: string; total: number; isMe: boolean }[];
};
export type SubmitScreen = {
  date: string;
  todayReward: number;
  todayPoints?: number;
  ranking: PersonalRanking | TeamRanking | null;
};

function RankBadge({ rank, highlight }: { rank: number; highlight?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
        highlight ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-600"
      }`}
    >
      {rank}
    </span>
  );
}

export function PostSubmitView({ data, onClose }: { data: SubmitScreen; onClose: () => void }) {
  const r = data.ranking;

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <div className="text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-2">
          <FontAwesomeIcon icon={faCheck} className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">日報を送信しました</h1>
      </div>

      {/* 今日の報酬見込み */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
        <div className="text-xs text-slate-500">今日の報酬（見込み）</div>
        <CountUp
          value={data.todayReward}
          durationMs={900}
          prefix="¥"
          className="mt-1 block text-3xl font-bold text-brand-900 tabular-nums"
        />
        <div className="mt-1 text-[11px] text-slate-400">承認後に確定します</div>
      </div>

      {/* チーム累計ポイント（今日のぶんだけ膨らむ） */}
      {r && r.mode === "team" && r.myTeam && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <FontAwesomeIcon icon={faTrophy} className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold text-slate-800">{r.eventName}</span>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.myTeam.color }} />
              {r.myTeam.name}・チーム累計ポイント
            </div>
            <CountUp
              value={r.myTeam.total + (data.todayPoints ?? 0)}
              from={r.myTeam.total}
              durationMs={1150}
              suffix=" pt"
              pop={(data.todayPoints ?? 0) > 0}
              ease={easeWave}
              className="mt-1 block text-4xl font-extrabold text-slate-900 tabular-nums"
            />
            {(data.todayPoints ?? 0) > 0 && (
              <div className="mt-1 text-xs font-medium text-amber-600">
                あなたの今日のぶん +{(data.todayPoints ?? 0).toLocaleString("ja-JP")} pt（承認後に反映）
              </div>
            )}
          </div>
        </div>
      )}

      {/* ランキング（順位公開時のみ） */}
      {r && r.mode === "team" && r.rankingVisible !== false && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="space-y-1.5">
            {r.teams.map((t) => (
              <div
                key={t.teamId}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                  t.teamId === r.myTeamId ? "bg-slate-100 ring-1 ring-slate-300" : "bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <RankBadge rank={t.rank} highlight={t.teamId === r.myTeamId} />
                  <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="font-semibold text-slate-800 truncate">{t.name}</span>
                  {t.teamId === r.myTeamId && <span className="text-[10px] text-slate-500">(自分)</span>}
                </div>
                <span className="font-bold tabular-nums text-slate-900">{t.total} pt</span>
              </div>
            ))}
          </div>
          {r.individuals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
              <div className="text-[11px] font-medium text-slate-500 mb-1">個人トップ</div>
              {r.individuals.slice(0, 5).map((d) => (
                <div key={`${d.rank}-${d.name}`} className={`flex items-center justify-between gap-2 text-xs px-1 py-0.5 ${d.isMe ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                  <span className="flex items-center gap-2 min-w-0">
                    <RankBadge rank={d.rank} highlight={d.isMe} />
                    <span className="truncate">{d.name}{d.isMe && " (あなた)"}</span>
                  </span>
                  <span className="tabular-nums shrink-0">{d.total} pt</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {r && r.mode === "personal" && (
        r.configured ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <FontAwesomeIcon icon={faChartColumn} className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-800">今月の{r.metricLabel}ランキング</span>
            </div>
            <div className="space-y-1">
              {r.ranking.map((d) => (
                <div
                  key={`${d.rank}-${d.name}`}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 ${d.isMe ? "bg-slate-100 ring-1 ring-slate-300 font-semibold text-slate-900" : "text-slate-600"}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <RankBadge rank={d.rank} highlight={d.isMe} />
                    <span className="truncate">{d.name}{d.isMe && " (あなた)"}</span>
                  </span>
                  <span className="tabular-nums shrink-0">{d.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {r.myRank && r.myRank.rank > r.ranking.length && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 bg-slate-100 ring-1 ring-slate-300 font-semibold text-slate-900 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <RankBadge rank={r.myRank.rank} highlight />
                  <span className="truncate">{r.myRank.name} (あなた)</span>
                </span>
                <span className="tabular-nums shrink-0">{r.myRank.value.toLocaleString()}</span>
              </div>
            )}
            <div className="mt-2 text-[11px] text-slate-400 text-right">{r.total}名中</div>
          </div>
        ) : null
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full py-3 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
      >
        続けて入力する
      </button>
    </div>
  );
}
