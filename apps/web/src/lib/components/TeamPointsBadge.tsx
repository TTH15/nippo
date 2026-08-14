"use client";

import { useEffect, useState } from "react";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { BonusOverlay } from "@/lib/components/BonusOverlay";

export type TeamStatus = {
  active: boolean;
  eventName?: string;
  myTeam: { id: string; name: string; color: string; points: number } | null;
  rankingVisible: boolean;
  teams?: { rank: number; teamId: string; name: string; color: string; total: number }[];
  pendingBonus: { points: number; count: number } | null;
};

/**
 * team-status の共有 SWR フック。常設バッジ（TeamPointsBadge）と /me のカード
 * （TeamPointsCard）が同一キーを共有し、dedup で1リクエストに畳む。
 * サーバー側はイベント全期間の日報集計を伴う重いAPIのため、ページ遷移ごとに
 * 撃たないよう dedup を長め（2分）にし、フォーカス復帰でも再検証しない。
 */
export function useTeamStatus() {
  // localStorage はハイドレーション後にしか読めないため、有効化はエフェクトで判定
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(!!getStoredDriver());
  }, []);
  return useApi<TeamStatus>(enabled ? "/api/me/team-status" : null, {
    dedupingInterval: 120_000,
    revalidateOnFocus: false,
  });
}

/**
 * (user) ヘッダーに常設するチームポイントバッジ。
 * 開催中チーム戦があり自チームに所属していれば「自チーム ◯◯pt」を表示。
 * 運営からの手動ボーナス未読があれば、起動時に1回だけ祝福オーバーレイを表示する。
 */
export function TeamPointsBadge() {
  const { data: status, mutate } = useTeamStatus();
  const [showBonus, setShowBonus] = useState(false);

  useEffect(() => {
    if (status?.pendingBonus && status.pendingBonus.points > 0) setShowBonus(true);
  }, [status]);

  const ackBonus = async () => {
    setShowBonus(false);
    try {
      await apiFetch("/api/me/bonus-seen", { method: "POST" });
      // 既読反映後のレスポンスでキャッシュを更新し、再検証での再演出を防ぐ
      void mutate();
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
