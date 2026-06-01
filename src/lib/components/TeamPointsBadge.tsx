"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { CountUp } from "@/lib/components/CountUp";

export type TeamStatus = {
  active: boolean;
  eventName?: string;
  myTeam: { id: string; name: string; color: string; points: number } | null;
  rankingVisible: boolean;
  teams?: { rank: number; teamId: string; name: string; color: string; total: number }[];
  pendingBonus: { points: number; count: number } | null;
};

/**
 * (user) ヘッダーに常設するチームポイントバッジ。
 * 開催中チーム戦があり自チームに所属していれば「自チーム ◯◯pt」を表示。
 * 運営からの手動ボーナス未読があれば、起動時に1回だけ祝福オーバーレイを表示する。
 */
export function TeamPointsBadge() {
  const [status, setStatus] = useState<TeamStatus | null>(null);
  const [showBonus, setShowBonus] = useState(false);

  const load = useCallback(async () => {
    // 未ログインでは取得しない
    if (!getStoredDriver()) return;
    try {
      const res = await apiFetch<TeamStatus>("/api/me/team-status");
      setStatus(res);
      if (res.pendingBonus && res.pendingBonus.points > 0) setShowBonus(true);
    } catch {
      // チーム戦未設定などは静かに無視
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ackBonus = async () => {
    setShowBonus(false);
    try {
      await apiFetch("/api/me/bonus-seen", { method: "POST" });
    } catch {
      /* noop */
    }
  };

  if (!status?.active || !status.myTeam) {
    // バッジ非表示でも、ボーナス演出だけは出す可能性に備える
    return showBonus && status?.pendingBonus ? (
      <BonusOverlay points={status.pendingBonus.points} onClose={ackBonus} />
    ) : null;
  }

  const t = status.myTeam;
  return (
    <>
      <div className="flex justify-center px-4 py-1.5 bg-white border-b border-slate-100">
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200 px-3 py-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: t.color }} />
          <span className="text-xs font-medium text-slate-700 truncate max-w-[40vw]">{t.name}</span>
          <span className="text-xs font-bold text-slate-900 tabular-nums">{t.points.toLocaleString("ja-JP")} pt</span>
        </div>
      </div>
      {showBonus && status.pendingBonus && (
        <BonusOverlay points={status.pendingBonus.points} onClose={ackBonus} />
      )}
    </>
  );
}

function BonusOverlay({ points, onClose }: { points: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-3xl bg-white p-7 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl mb-2">🎉</div>
        <h2 className="text-base font-semibold text-slate-900">ボーナスポイントが付与されました</h2>
        <CountUp
          value={points}
          durationMs={1000}
          prefix="+"
          suffix=" pt"
          className="mt-3 block text-4xl font-extrabold text-amber-500 tabular-nums"
        />
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-900"
        >
          やった！
        </button>
      </div>
    </div>
  );
}
