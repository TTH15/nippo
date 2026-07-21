"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLine } from "@fortawesome/free-brands-svg-icons";
import { useApi } from "@/lib/useApi";

// ============================================================
// LINE 今月の残り通数（roadmap-2026-07 E④）。
// scope="org"     … こちらが設定した org 月上限に対する残数（自前カウント）。
// scope="channel" … org 上限未設定時。LINE 公式 API のチャネル全体の実値。
//   ★channel はチャネル全体の合計で、会社ごとの内訳ではない。
// ============================================================

type QuotaRes = {
  configured: boolean;
  scope: "org" | "channel" | null;
  quota: { limit: number | null; used: number; remaining: number | null } | null;
};

export function QuotaBar() {
  const { data } = useApi<QuotaRes>("/api/admin/notifications/quota", {
    refreshInterval: 5 * 60_000,
  });

  if (!data?.configured || !data.quota) return null;

  const { limit, used, remaining } = data.quota;
  const isChannel = data.scope === "channel";
  const note = isChannel
    ? "会社ごとの内訳ではなく、公式アカウント全体の合計です。一斉配信・チャットの送信で消費します。"
    : "今月このアカウントに送れる残り通数です。一斉配信・チャットの送信で消費します。";

  // 無制限（従量 or 上限なし）は使用数だけ
  if (limit === null) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
        <FontAwesomeIcon icon={faLine} className="shrink-0 text-[#06C755]" />
        <span>
          今月のLINE送信数{isChannel ? "（全体）" : ""}:{" "}
          <span className="font-medium tabular-nums">{used.toLocaleString()}</span> 通
        </span>
      </div>
    );
  }

  const rate = limit > 0 ? Math.min(1, used / limit) : 0;
  const low = remaining !== null && remaining <= limit * 0.1;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 text-slate-600">
          <FontAwesomeIcon icon={faLine} className="shrink-0 text-[#06C755]" />
          今月のLINE残り通数{isChannel ? "（全体）" : ""}
        </span>
        <span className={`font-medium tabular-nums ${low ? "text-amber-600" : "text-slate-800"}`}>
          残り {remaining?.toLocaleString()} / {limit.toLocaleString()} 通
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${low ? "bg-amber-500" : "bg-[#06C755]"}`}
          style={{ width: `${Math.round(rate * 100)}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-400">{note}</p>
    </div>
  );
}
