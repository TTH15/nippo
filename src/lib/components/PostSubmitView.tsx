"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faTrophy, faChartColumn } from "@fortawesome/free-solid-svg-icons";
import { CountUp, easeWave } from "@/lib/components/CountUp";
import type { ResolvedBlock } from "@/lib/submitScreenBlocks";

// ============================================================
// 日報送信後の画面（個数の報告後に見える画面）。
//   ブロックの並び（ResolvedBlock[]）を順に描画する。
//   本番（SubmitPageClientV2）と設定画面のライブプレビューで共用する。
// ============================================================

export type SubmitScreen = {
  date?: string;
  todayReward?: number;
  blocks: ResolvedBlock[];
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

function GreetingBlockView({ title, message }: { title: string; message: string }) {
  return (
    <div className="text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-2">
        <FontAwesomeIcon icon={faCheck} className="h-5 w-5" />
      </div>
      <h1 className="text-lg font-semibold text-slate-900">{title.trim() || "日報を送信しました"}</h1>
      {message.trim() && <p className="mt-1.5 text-sm text-slate-600 whitespace-pre-wrap">{message}</p>}
    </div>
  );
}

function RewardBlockView({ todayReward }: { todayReward: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
      <div className="text-xs text-slate-500">今日の報酬（見込み）</div>
      <CountUp
        value={todayReward}
        durationMs={900}
        prefix="¥"
        className="mt-1 block text-3xl font-bold text-brand-900 tabular-nums"
      />
      <div className="mt-1 text-[11px] text-slate-400">承認後に確定します</div>
    </div>
  );
}

function EventPointsBlockView({ block }: { block: Extract<ResolvedBlock, { type: "event_points" }> }) {
  return (
    <div className="space-y-3">
      {block.myTeam && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-3">
            <FontAwesomeIcon icon={faTrophy} className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold text-slate-800">{block.eventName}</span>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: block.myTeam.color }} />
              {block.myTeam.name}・チーム累計ポイント
            </div>
            <CountUp
              value={block.myTeam.total + block.todayPoints}
              from={block.myTeam.total}
              durationMs={1150}
              suffix=" pt"
              pop={block.todayPoints > 0}
              ease={easeWave}
              className="mt-1 block text-4xl font-extrabold text-slate-900 tabular-nums"
            />
            {block.todayPoints > 0 && (
              <div className="mt-1 text-xs font-medium text-amber-600">
                あなたの今日のぶん +{block.todayPoints.toLocaleString("ja-JP")} pt（承認後に反映）
              </div>
            )}
          </div>
        </div>
      )}

      {block.rankingVisible && block.teams.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="space-y-1.5">
            {block.teams.map((t) => (
              <div
                key={t.teamId}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                  t.teamId === block.myTeamId ? "bg-slate-100 ring-1 ring-slate-300" : "bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <RankBadge rank={t.rank} highlight={t.teamId === block.myTeamId} />
                  <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="font-semibold text-slate-800 truncate">{t.name}</span>
                  {t.teamId === block.myTeamId && <span className="text-[10px] text-slate-500">(自分)</span>}
                </div>
                <span className="font-bold tabular-nums text-slate-900">{t.total} pt</span>
              </div>
            ))}
          </div>
          {block.individuals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
              <div className="text-[11px] font-medium text-slate-500 mb-1">個人トップ</div>
              {block.individuals.slice(0, 5).map((d) => (
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
    </div>
  );
}

function PersonalCountBlockView({ block }: { block: Extract<ResolvedBlock, { type: "personal_count" }> }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
      <div className="text-xs text-slate-500">{block.label}</div>
      <CountUp
        value={block.value}
        durationMs={900}
        suffix=" 個"
        className="mt-1 block text-3xl font-bold text-slate-900 tabular-nums"
      />
    </div>
  );
}

function PersonalRankingBlockView({ block }: { block: Extract<ResolvedBlock, { type: "personal_ranking" }> }) {
  if (!block.configured) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <FontAwesomeIcon icon={faChartColumn} className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">{block.label}</span>
      </div>
      <div className="space-y-1">
        {block.ranking.map((d) => (
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
      {block.myRank && block.myRank.rank > block.ranking.length && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 bg-slate-100 ring-1 ring-slate-300 font-semibold text-slate-900 text-sm">
          <span className="flex items-center gap-2 min-w-0">
            <RankBadge rank={block.myRank.rank} highlight />
            <span className="truncate">{block.myRank.name} (あなた)</span>
          </span>
          <span className="tabular-nums shrink-0">{block.myRank.value.toLocaleString()}</span>
        </div>
      )}
      <div className="mt-2 text-[11px] text-slate-400 text-right">{block.total}名中</div>
    </div>
  );
}

function BlockView({ block }: { block: ResolvedBlock }) {
  switch (block.type) {
    case "greeting":
      return <GreetingBlockView title={block.title} message={block.message} />;
    case "today_reward":
      return <RewardBlockView todayReward={block.todayReward} />;
    case "event_points":
      return <EventPointsBlockView block={block} />;
    case "personal_count":
      return <PersonalCountBlockView block={block} />;
    case "personal_ranking":
      return <PersonalRankingBlockView block={block} />;
    default:
      return null;
  }
}

export function PostSubmitView({ data, onClose }: { data: SubmitScreen; onClose: () => void }) {
  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      {data.blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}

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
