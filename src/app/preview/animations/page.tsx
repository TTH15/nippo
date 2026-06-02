"use client";

// ============================================================
// アニメーション調整用プレビュー（開発用・認証不要）。
//   /preview/animations で、提出後のカウントアップ／ボーナス演出を
//   モックデータで確認・調整できる。本番フローには影響しない。
// ============================================================

import { useState } from "react";
import { CountUp, easeWave } from "@/lib/components/CountUp";
import { BonusOverlay } from "@/lib/components/BonusOverlay";

export default function AnimationsPreviewPage() {
  const [reward, setReward] = useState(18500);
  const [baseTotal, setBaseTotal] = useState(860);
  const [gain, setGain] = useState(120);
  const [bonus, setBonus] = useState(50);
  const [duration, setDuration] = useState(1150);
  const [playKey, setPlayKey] = useState(0);
  const [showBonus, setShowBonus] = useState(false);

  const replay = () => setPlayKey((k) => k + 1);

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-md mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-900">アニメーション プレビュー</h1>
          <p className="text-xs text-slate-500 mt-1">
            送信後のカウントアップとボーナス演出を調整用に表示します（モックデータ・開発専用）。
          </p>
        </div>

        {/* コントロール */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-sm">
          <Control label={`報酬: ¥${reward.toLocaleString()}`}>
            <input type="range" min={0} max={100000} step={500} value={reward}
              onChange={(e) => setReward(Number(e.target.value))} className="w-full" />
          </Control>
          <Control label={`チーム累計（今日前）: ${baseTotal}pt`}>
            <input type="range" min={0} max={5000} step={10} value={baseTotal}
              onChange={(e) => setBaseTotal(Number(e.target.value))} className="w-full" />
          </Control>
          <Control label={`今日のぶん: +${gain}pt`}>
            <input type="range" min={0} max={1000} step={10} value={gain}
              onChange={(e) => setGain(Number(e.target.value))} className="w-full" />
          </Control>
          <Control label={`ボーナス: +${bonus}pt`}>
            <input type="range" min={0} max={500} step={10} value={bonus}
              onChange={(e) => setBonus(Number(e.target.value))} className="w-full" />
          </Control>
          <Control label={`カウントアップ時間: ${duration}ms`}>
            <input type="range" min={300} max={2500} step={50} value={duration}
              onChange={(e) => setDuration(Number(e.target.value))} className="w-full" />
          </Control>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={replay}
              className="flex-1 rounded-lg bg-slate-800 text-white py-2 text-sm font-medium hover:bg-slate-900">
              カウントアップ再生
            </button>
            <button type="button" onClick={() => setShowBonus(true)}
              className="flex-1 rounded-lg bg-amber-500 text-white py-2 text-sm font-medium hover:bg-amber-600">
              ボーナス演出を再生
            </button>
          </div>
        </div>

        {/* 送信後カード（実物と同じ見た目） */}
        <div className="space-y-5" key={playKey}>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
            <div className="text-xs text-slate-500">今日の報酬（見込み）</div>
            <CountUp value={reward} durationMs={duration} prefix="¥"
              className="mt-1 block text-3xl font-bold text-brand-900 tabular-nums" />
            <div className="mt-1 text-[11px] text-slate-400">承認後に確定します</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
            <div className="text-xs text-slate-500">チーム累計ポイント</div>
            <CountUp value={baseTotal + gain} from={baseTotal} durationMs={duration} suffix=" pt"
              pop={gain > 0}
              ease={easeWave}
              className="mt-1 block text-4xl font-extrabold text-slate-900 tabular-nums" />
            {gain > 0 && (
              <div className="mt-1 text-xs font-medium text-amber-600">
                あなたの今日のぶん +{gain.toLocaleString()} pt（承認後に反映）
              </div>
            )}
          </div>
        </div>
      </div>

      {showBonus && <BonusOverlay points={bonus} onClose={() => setShowBonus(false)} />}
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
