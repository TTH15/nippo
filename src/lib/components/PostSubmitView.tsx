"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faTrophy, faChartColumn } from "@fortawesome/free-solid-svg-icons";
import { CountUp, easeWave } from "@/lib/components/CountUp";
import type { ResolvedBlock } from "@/lib/submitScreenBlocks";

// ============================================================
// 日報送信後の画面（個数の報告後に見える達成サマリー）。
//   ブロックの並び（ResolvedBlock[]）を順に描画。段階的にフェードインする。
//   本番（SubmitPageClientV2）と設定画面のライブプレビューで共用する。
// ============================================================

function RankBadge({ rank, highlight }: { rank: number; highlight?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
        highlight ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-500"
      }`}
    >
      {rank}
    </span>
  );
}

/** 全ブロック共通のカード外観。 */
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[1.75rem] border border-slate-200/70 bg-white shadow-[0_4px_24px_-12px_rgba(15,23,42,0.18)] ${className}`}
    >
      {children}
    </div>
  );
}

function GreetingBlockView({ title, message }: { title: string; message: string }) {
  return (
    <div className="relative text-center pt-1">
      {/* 達成シール */}
      <div className="relative mx-auto mb-4 inline-flex">
        <span className="absolute inset-0 -m-2.5 rounded-full bg-emerald-400/25 blur-lg" aria-hidden />
        <span className="psv-seal relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 ring-[5px] ring-white">
          <FontAwesomeIcon icon={faCheck} className="h-6 w-6" />
        </span>
      </div>
      <h1 className="plate-font-hiragana text-[1.6rem] leading-tight tracking-wide text-slate-900">
        {title.trim() || "日報を送信しました"}
      </h1>
      {message.trim() && (
        <p className="mx-auto mt-2 max-w-[18rem] text-sm leading-relaxed text-slate-500 whitespace-pre-wrap">{message}</p>
      )}
    </div>
  );
}

function RewardBlockView({ todayReward }: { todayReward: number }) {
  return (
    <Card className="overflow-hidden">
      {/* 上端のゴールドのアクセントライン */}
      <div className="h-1 w-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-300" />
      <div className="px-6 py-6 text-center">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          今日の報酬（見込み）
        </div>
        <CountUp
          value={todayReward}
          durationMs={1000}
          prefix="¥"
          className="mt-1.5 block text-[2.9rem] leading-none font-bold tabular-nums text-slate-900"
        />
        <div className="mt-3">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-500">
            承認後に確定します
          </span>
        </div>
      </div>
    </Card>
  );
}

function EventPointsBlockView({ block }: { block: Extract<ResolvedBlock, { type: "event_points" }> }) {
  return (
    <div className="space-y-3">
      {block.myTeam && (
        <Card className="px-6 py-6">
          <div className="flex items-center justify-center gap-2">
            <FontAwesomeIcon icon={faTrophy} className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-semibold tracking-wide text-slate-500">{block.eventName}</span>
          </div>
          <div className="mt-4 text-center">
            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
              <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: block.myTeam.color }} />
              {block.myTeam.name}・チーム累計
            </div>
            <div className="mt-1 flex items-baseline justify-center gap-1.5">
              <CountUp
                value={block.myTeam.total + block.todayPoints}
                from={block.myTeam.total}
                durationMs={1200}
                pop={block.todayPoints > 0}
                ease={easeWave}
                className="block text-[3.25rem] leading-none font-extrabold tabular-nums text-slate-900"
              />
              <span className="text-base font-bold text-slate-400">pt</span>
            </div>
            {block.todayPoints > 0 && (
              <div className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
                ＋{block.todayPoints.toLocaleString("ja-JP")} pt（今日のぶん・承認後に反映）
              </div>
            )}
          </div>
        </Card>
      )}

      {block.rankingVisible && block.teams.length > 0 && (
        <Card className="px-4 py-4">
          <div className="space-y-1.5">
            {block.teams.map((t) => {
              const mine = t.teamId === block.myTeamId;
              return (
                <div
                  key={t.teamId}
                  className={`flex items-center justify-between rounded-2xl px-3 py-2.5 transition-colors ${
                    mine ? "bg-slate-900/[0.04] ring-1 ring-slate-900/10" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <RankBadge rank={t.rank} highlight={mine} />
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ background: t.color }} />
                    <span className="truncate font-semibold text-slate-800">{t.name}</span>
                    {mine && <span className="text-[10px] font-medium text-slate-400">(自分)</span>}
                  </div>
                  <span className="shrink-0 font-bold tabular-nums text-slate-900">
                    {t.total}
                    <span className="ml-0.5 text-xs font-medium text-slate-400">pt</span>
                  </span>
                </div>
              );
            })}
          </div>
          {block.individuals.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">個人トップ</div>
              <div className="space-y-0.5">
                {block.individuals.slice(0, 5).map((d) => (
                  <div
                    key={`${d.rank}-${d.name}`}
                    className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1 text-xs ${d.isMe ? "bg-slate-900/[0.04] font-semibold text-slate-900" : "text-slate-500"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <RankBadge rank={d.rank} highlight={d.isMe} />
                      <span className="truncate">{d.name}{d.isMe && " (あなた)"}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{d.total} pt</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function PersonalCountBlockView({ block }: { block: Extract<ResolvedBlock, { type: "personal_count" }> }) {
  return (
    <Card className="px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">{block.label}</span>
        <div className="flex items-baseline gap-1">
          <CountUp value={block.value} durationMs={900} className="text-3xl font-bold tabular-nums text-slate-900" />
          <span className="text-sm font-semibold text-slate-400">個</span>
        </div>
      </div>
    </Card>
  );
}

function PersonalRankingBlockView({ block }: { block: Extract<ResolvedBlock, { type: "personal_ranking" }> }) {
  if (!block.configured) return null;
  return (
    <Card className="px-4 py-4">
      <div className="mb-3 flex items-center gap-2 px-1">
        <FontAwesomeIcon icon={faChartColumn} className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-semibold tracking-wide text-slate-600">{block.label}</span>
      </div>
      <div className="space-y-0.5">
        {block.ranking.map((d) => (
          <div
            key={`${d.rank}-${d.name}`}
            className={`flex items-center justify-between gap-2 rounded-2xl px-3 py-2 ${d.isMe ? "bg-slate-900/[0.04] font-semibold text-slate-900 ring-1 ring-slate-900/10" : "text-slate-500"}`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <RankBadge rank={d.rank} highlight={d.isMe} />
              <span className="truncate">{d.name}{d.isMe && " (あなた)"}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-900">{d.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {block.myRank && block.myRank.rank > block.ranking.length && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border-t border-slate-100 bg-slate-900/[0.04] px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-900/10">
          <span className="flex min-w-0 items-center gap-2.5">
            <RankBadge rank={block.myRank.rank} highlight />
            <span className="truncate">{block.myRank.name} (あなた)</span>
          </span>
          <span className="shrink-0 tabular-nums">{block.myRank.value.toLocaleString()}</span>
        </div>
      )}
      <div className="mt-2 px-1 text-right text-[11px] text-slate-400">{block.total}名中</div>
    </Card>
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

export type SubmitScreen = {
  date?: string;
  todayReward?: number;
  blocks: ResolvedBlock[];
};

export function PostSubmitView({ data, onClose }: { data: SubmitScreen; onClose: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-7 space-y-4">
      {data.blocks.map((b, i) => (
        <div key={b.id} className="psv-reveal" style={{ animationDelay: `${i * 90}ms` }}>
          <BlockView block={b} />
        </div>
      ))}

      <div className="psv-reveal pt-1" style={{ animationDelay: `${data.blocks.length * 90}ms` }}>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition-transform active:scale-[0.99] hover:bg-slate-800"
        >
          続けて入力する
        </button>
      </div>
    </div>
  );
}
