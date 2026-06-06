"use client";

// ============================================================
// 送信後画面（個数の報告後に見える画面）の調整用プレビュー（開発用・認証不要）。
//   /preview/post-submit。モックデータで PostSubmitView を表示・調整できる。
// ============================================================

import { useState } from "react";
import { PostSubmitView, type SubmitScreen } from "@/lib/components/PostSubmitView";
import type { ResolvedBlock } from "@/lib/submitScreenBlocks";

type Scenario = "team_hidden" | "team_ranked" | "team_and_count" | "personal" | "none";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "team_hidden", label: "チーム戦・順位非公開" },
  { key: "team_ranked", label: "チーム戦・順位公開" },
  { key: "team_and_count", label: "チームpt＋個人個数" },
  { key: "personal", label: "個人ランキング" },
  { key: "none", label: "イベントなし" },
];

function buildData(s: Scenario, reward: number, todayPoints: number, teamTotal: number): SubmitScreen {
  const greeting: ResolvedBlock = { id: "g", type: "greeting", title: "お疲れさまでした", message: "" };
  const rewardBlock: ResolvedBlock = { id: "r", type: "today_reward", todayReward: reward };
  const countBlock: ResolvedBlock = { id: "c", type: "personal_count", label: "今月の完了個数", value: 1510 };
  const personalRanking: ResolvedBlock = {
    id: "pr",
    type: "personal_ranking",
    label: "今月の完了個数ランキング",
    configured: true,
    ranking: [
      { rank: 1, name: "木下", value: 1820, isMe: false },
      { rank: 2, name: "廣瀬", value: 1640, isMe: false },
      { rank: 3, name: "日笠", value: 1510, isMe: true },
      { rank: 4, name: "梶原", value: 1390, isMe: false },
      { rank: 5, name: "坂田", value: 1180, isMe: false },
    ],
    myRank: { rank: 3, name: "日笠", value: 1510, isMe: true },
    total: 12,
  };
  const myTeam = { id: "t1", name: "次期幹部", color: "#3b82f6", total: teamTotal };
  const eventBlock = (visible: boolean): ResolvedBlock => ({
    id: "ev",
    type: "event_points",
    eventName: "6月チーム戦",
    myTeamId: "t1",
    myTeam,
    todayPoints,
    showRanking: visible,
    rankingVisible: visible,
    teams: visible
      ? [
          { rank: 1, teamId: "t2", name: "名称未設定", color: "#ef4444", total: teamTotal + 120 },
          { rank: 2, teamId: "t1", name: "次期幹部", color: "#3b82f6", total: teamTotal },
          { rank: 3, teamId: "t3", name: "誤配ゼロ", color: "#22c55e", total: teamTotal - 80 },
        ]
      : [],
    individuals: visible
      ? [
          { rank: 1, name: "梶原", total: 540, isMe: false },
          { rank: 2, name: "勝政", total: 480, isMe: false },
          { rank: 3, name: "日笠", total: 430, isMe: true },
        ]
      : [],
  });

  const base = { date: "2026-06-03", todayReward: reward };
  if (s === "none") return { ...base, blocks: [greeting, rewardBlock] };
  if (s === "personal") return { ...base, blocks: [greeting, rewardBlock, countBlock, personalRanking] };
  if (s === "team_and_count") return { ...base, blocks: [greeting, rewardBlock, eventBlock(false), countBlock] };
  if (s === "team_hidden") return { ...base, blocks: [greeting, rewardBlock, eventBlock(false)] };
  return { ...base, blocks: [greeting, rewardBlock, eventBlock(true)] };
}

export default function PostSubmitPreviewPage() {
  const [scenario, setScenario] = useState<Scenario>("team_hidden");
  const [reward, setReward] = useState(18500);
  const [todayPoints, setTodayPoints] = useState(120);
  const [teamTotal, setTeamTotal] = useState(2090);
  const [playKey, setPlayKey] = useState(0);

  const data = buildData(scenario, reward, todayPoints, teamTotal);
  const isTeam = scenario === "team_hidden" || scenario === "team_ranked" || scenario === "team_and_count";

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-md mx-auto space-y-6">
        <div>
          <a href="/preview" className="text-xs text-slate-500 hover:text-slate-800">← プレビュー一覧</a>
          <h1 className="text-lg font-bold text-slate-900 mt-1">送信後画面 プレビュー</h1>
          <p className="text-xs text-slate-500 mt-1">
            個数の報告後に表示される画面をモックデータで確認・調整できます（開発専用）。
          </p>
        </div>

        {/* コントロール */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-sm">
          <div>
            <span className="block text-xs font-medium text-slate-600 mb-1.5">状態</span>
            <div className="flex flex-wrap gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScenario(s.key)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                    scenario === s.key
                      ? "bg-slate-800 text-white border-slate-800"
                      : "text-slate-600 border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <Control label={`報酬: ¥${reward.toLocaleString()}`}>
            <input type="range" min={0} max={100000} step={500} value={reward}
              onChange={(e) => setReward(Number(e.target.value))} className="w-full" />
          </Control>
          {isTeam && (
            <>
              <Control label={`チーム累計（今日前）: ${teamTotal}pt`}>
                <input type="range" min={0} max={5000} step={10} value={teamTotal}
                  onChange={(e) => setTeamTotal(Number(e.target.value))} className="w-full" />
              </Control>
              <Control label={`今日のぶん: +${todayPoints}pt`}>
                <input type="range" min={0} max={1000} step={10} value={todayPoints}
                  onChange={(e) => setTodayPoints(Number(e.target.value))} className="w-full" />
              </Control>
            </>
          )}
          <button type="button" onClick={() => setPlayKey((k) => k + 1)}
            className="w-full rounded-lg bg-slate-800 text-white py-2 text-sm font-medium hover:bg-slate-900">
            アニメーション再生
          </button>
        </div>

        {/* 実物プレビュー */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" key={playKey}>
          <PostSubmitView data={data} onClose={() => setPlayKey((k) => k + 1)} />
        </div>
      </div>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1 tabular-nums">{label}</span>
      {children}
    </label>
  );
}
