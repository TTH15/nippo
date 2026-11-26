"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faTrophy, faChartColumn } from "@fortawesome/free-solid-svg-icons";
import { CountUp, easeWave } from "@/lib/components/CountUp";
import { useReducedMotion } from "motion/react";
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

function GreetingBlockView({ title, message, confirmed = false }: { title: string; message: string; confirmed?: boolean }) {
  const customTitle = title.trim();
  const showCustomTitle = confirmed && customTitle && !["日報を送信しました", "日報の送信が完了しました！"].includes(customTitle);
  return (
    <div className="text-center pt-1">
      <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <FontAwesomeIcon icon={faCheck} className="h-5 w-5" />
      </div>
      <h1 className="text-lg font-bold text-slate-900">
        {confirmed ? "日報の送信が完了しました！" : customTitle || "日報を送信しました"}
      </h1>
      {showCustomTitle && <p className="mt-2 text-sm font-medium text-slate-700">{customTitle}</p>}
      {message.trim() && (
        <p className="mx-auto mt-1.5 max-w-[18rem] text-sm leading-relaxed text-slate-500 whitespace-pre-wrap">{message}</p>
      )}
    </div>
  );
}

function RewardBlockView({ block }: { block: Extract<ResolvedBlock, { type: "today_reward" }> }) {
  const { todayReward, breakdown } = block;
  const pending = breakdown?.includedPendingCourseCount;
  const reduceMotion = useReducedMotion();
  const amount = todayReward.toLocaleString("ja-JP");
  const amountClass = "mt-1 block text-[2.5rem] leading-none font-bold tabular-nums text-slate-900";
  return (
    <Card className="px-5 py-5 text-center">
      <div className="text-xs font-medium text-slate-500">今日の報酬（見込み・目安）</div>
      <span className="sr-only">{amount}円</span>
      <div aria-hidden="true">
        {reduceMotion ? <span className={amountClass}>¥{amount}</span> : (
          <CountUp value={todayReward} durationMs={900} prefix="¥" className={amountClass} />
        )}
      </div>
      {breakdown && (
        <>
          <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-sm text-slate-700">
            <div className="flex items-baseline justify-between gap-2 text-left">
              <dt>リース控除前（税込）</dt><dd className="shrink-0 tabular-nums">{breakdown.beforeLease.toLocaleString("ja-JP")}円</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-left">
              <dt>{breakdown.dailyLease > 0 ? "日額リース（1日分）" : "日額リース"}</dt><dd className="shrink-0 tabular-nums">{breakdown.dailyLease > 0 ? "−" : ""}{breakdown.dailyLease.toLocaleString("ja-JP")}円</dd>
            </div>
          </dl>
          {breakdown.monthlyLease && <p className="mt-2 text-xs text-slate-500">月額リースは月の報酬から差し引きます。</p>}
          {pending != null && pending > 0 && (
            <p className="mt-2 text-xs text-slate-600">承認待ちの追加コース{pending}件を含みます。</p>
          )}
        </>
      )}
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
      return <RewardBlockView block={block} />;
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

/** 同じ表示のまま、確認できた処理境界でのみバーを進める。 */
export function ReportSubmitWaitView({ phase }: { phase: "submit" | "reward" }) {
  // 見た目の位置であって、処理時間や実測パーセントではない。
  const fillScale = phase === "submit" ? 0.25 : 0.75;
  return (
    <section data-report-stage="waiting" className="mx-auto flex min-h-[calc(100svh-10rem)] w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-7 text-center shadow-sm sm:px-7">
        <h1 role="status" className="text-xl font-bold text-slate-900">送信しています</h1>
        <div role="progressbar" aria-label="日報の処理状況"
          className="mx-auto mt-5 h-2 max-w-64 overflow-hidden rounded-full bg-slate-200">
          <div aria-hidden="true" className="h-full origin-left rounded-full bg-amber-500 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
            style={{ transform: `scaleX(${fillScale})` }} />
        </div>
      </div>
    </section>
  );
}

export function PostSubmitView({ data, confirmed = false, onRetry, onClose }: {
  data: SubmitScreen | null;
  confirmed?: boolean;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const firstGreeting = confirmed ? (data?.blocks.findIndex((b) => b.type === "greeting") ?? -1) : -1;
  return (
    <div data-report-stage="complete" className="mx-auto max-w-md px-4 py-6 space-y-4">
      {confirmed && data && firstGreeting === -1 && <GreetingBlockView title="" message="" confirmed />}
      {data ? data.blocks.map((b, i) => {
        if (b.type === "greeting" && i === firstGreeting) return <GreetingBlockView key={b.id} title={b.title} message={b.message} confirmed />;
        return (
          <div key={b.id} className="psv-reveal" style={{ animationDelay: `${i * 80}ms` }}>
            <BlockView block={b} />
          </div>
        );
      }) : (
        <>
          <GreetingBlockView title="" message="" confirmed />
          <Card className="px-5 py-5 text-center">
            <p role="alert" className="text-sm font-medium text-slate-700">日報は保存済みですが、報酬の見込みを読み込めませんでした。</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-700">
                報酬を読み込み直す
              </button>
            )}
          </Card>
        </>
      )}
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
