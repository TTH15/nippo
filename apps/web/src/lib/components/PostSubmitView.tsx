"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faTrophy, faChartColumn } from "@fortawesome/free-solid-svg-icons";
import { CountUp, easeWave } from "@/lib/components/CountUp";
import type { ResolvedBlock } from "@/lib/submitScreenBlocks";

// ============================================================
// 日報送信後の画面（個数の報告後に見える達成サマリー）。
//   ブロックの並び（ResolvedBlock[]）を順に描画。段階的にフェードインする。
//   デザインは他のドライバー画面（送信フォーム等）と統一:
//     カード = rounded-xl + 細ボーダー / 見出し = ゴシック / slate基調。
//   本番（SubmitPageClientV2）と設定画面のライブプレビューで共用する。
// ============================================================

// タップ域を確保した共通の押下サイズ（最小 44px 以上）。
function RankBadge({ rank, highlight }: { rank: number; highlight?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
        highlight ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
      }`}
    >
      {rank}
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

function GreetingBlockView({ title, message }: { title: string; message: string }) {
  return (
    <div className="text-center pt-1">
      <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <FontAwesomeIcon icon={faCheck} className="h-5 w-5" />
      </div>
      <h1 className="text-lg font-bold text-slate-900">{title.trim() || "日報を送信しました"}</h1>
      {message.trim() && (
        <p className="mx-auto mt-1.5 max-w-[18rem] text-sm leading-relaxed text-slate-500 whitespace-pre-wrap">{message}</p>
      )}
    </div>
  );
}

function RewardBlockView({ todayReward }: { todayReward: number }) {
  return (
    <Card className="px-5 py-5 text-center">
      <div className="text-xs font-medium text-slate-500">今日の報酬（見込み・目安）</div>
      <CountUp
        value={todayReward}
        durationMs={900}
        prefix="¥"
        className="mt-1 block text-[2.5rem] leading-none font-bold tabular-nums text-slate-900"
      />
      <div className="mt-2 text-[11px] text-slate-400">承認後に確定します</div>
    </Card>
  );
}

function EventPointsBlockView({ block }: { block: Extract<ResolvedBlock, { type: "event_points" }> }) {
  return (
    <div className="space-y-3">
      {block.myTeam && (
        <Card className="px-5 py-5">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faTrophy} className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold text-slate-800">{block.eventName}</span>
          </div>
          <div className="mt-3 text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: block.myTeam.color }} />
              {block.myTeam.name}・チーム累計ポイント
            </div>
            <div className="mt-1 flex items-baseline justify-center gap-1">
              <CountUp
                value={block.myTeam.total + block.todayPoints}
                from={block.myTeam.total}
                durationMs={1150}
                pop={block.todayPoints > 0}
                ease={easeWave}
                className="block text-[2.75rem] leading-none font-extrabold tabular-nums text-slate-900"
              />
              <span className="text-base font-bold text-slate-400">pt</span>
            </div>
            {block.todayPoints > 0 && (
              <div className="mt-2 text-xs font-medium text-amber-600">
                あなたの今日のぶん +{block.todayPoints.toLocaleString("ja-JP")} pt（承認後に反映）
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
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${mine ? "bg-slate-100" : "bg-slate-50"}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <RankBadge rank={t.rank} highlight={mine} />
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="truncate font-semibold text-slate-800">{t.name}</span>
                    {mine && <span className="text-[10px] text-slate-500">(自分)</span>}
                  </div>
                  <span className="shrink-0 font-bold tabular-nums text-slate-900">{t.total} pt</span>
                </div>
              );
            })}
          </div>
          {block.individuals.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 space-y-1">
              <div className="mb-1 text-[11px] font-medium text-slate-500">個人トップ</div>
              {block.individuals.slice(0, 5).map((d) => (
                <div
                  key={`${d.rank}-${d.name}`}
                  className={`flex items-center justify-between gap-2 px-1 py-0.5 text-xs ${d.isMe ? "font-semibold text-slate-900" : "text-slate-600"}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <RankBadge rank={d.rank} highlight={d.isMe} />
                    <span className="truncate">{d.name}{d.isMe && " (あなた)"}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{d.total} pt</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function PersonalCountBlockView({ block }: { block: Extract<ResolvedBlock, { type: "personal_count" }> }) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-600">{block.label}</span>
        <span className="flex items-baseline gap-1">
          <CountUp value={block.value} durationMs={900} className="text-2xl font-bold tabular-nums text-slate-900" />
          <span className="text-sm font-semibold text-slate-400">個</span>
        </span>
      </div>
    </Card>
  );
}

function PersonalRankingBlockView({ block }: { block: Extract<ResolvedBlock, { type: "personal_ranking" }> }) {
  if (!block.configured) return null;
  return (
    <Card className="px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <FontAwesomeIcon icon={faChartColumn} className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">{block.label}</span>
      </div>
      <div className="space-y-1">
        {block.ranking.map((d) => (
          <div
            key={`${d.rank}-${d.name}`}
            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${d.isMe ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-600"}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <RankBadge rank={d.rank} highlight={d.isMe} />
              <span className="truncate">{d.name}{d.isMe && " (あなた)"}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-900">{d.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {block.myRank && block.myRank.rank > block.ranking.length && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border-t border-slate-100 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900">
          <span className="flex min-w-0 items-center gap-2">
            <RankBadge rank={block.myRank.rank} highlight />
            <span className="truncate">{block.myRank.name} (あなた)</span>
          </span>
          <span className="shrink-0 tabular-nums">{block.myRank.value.toLocaleString()}</span>
        </div>
      )}
      <div className="mt-2 text-right text-[11px] text-slate-400">{block.total}名中</div>
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

export function PostSubmitView({ data, onClose }: { data: SubmitScreen | null; onClose: () => void }) {
  // data 未着（送信直後の後追い取得中）はスケルトンを見せる。送信完了は既に確定しているので
  // 画面遷移をブロックしない（POST+GET の合計時間ブロックの解消・2026-08 監査）
  if (!data) {
    return (
      <div className="mx-auto max-w-md px-4 py-6 space-y-4">
        <div className="h-28 w-full animate-pulse rounded-xl bg-slate-100" />
        <div className="h-44 w-full animate-pulse rounded-xl bg-slate-100" />
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[3.25rem] rounded-xl bg-slate-900 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-slate-800 active:bg-slate-950"
        >
          続けて入力する
        </button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md px-4 py-6 space-y-4">
      {data.blocks.map((b, i) => (
        <div key={b.id} className="psv-reveal" style={{ animationDelay: `${i * 80}ms` }}>
          <BlockView block={b} />
        </div>
      ))}

      <div className="psv-reveal pt-1" style={{ animationDelay: `${data.blocks.length * 80}ms` }}>
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[3.25rem] rounded-xl bg-slate-900 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-slate-800 active:bg-slate-950"
        >
          続けて入力する
        </button>
      </div>
    </div>
  );
}
