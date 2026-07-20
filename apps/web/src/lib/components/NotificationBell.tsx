"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";

// ============================================================
// ヘッダーの未読ベル（roadmap-2026-07 E⑤）。
// 下部タブは5個＋中央円形ボタン（CENTER_INDEX=2）の構成で、6個目を足すと
// 中央がズレるため、お知らせへの導線はヘッダーに置く。
// 未ログイン時は取得しない（TeamPointsBadge と同じ方針）。
// ============================================================

export function NotificationBell() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getStoredDriver()));
  }, []);

  // SWR のグローバルキャッシュに乗るため、画面遷移で再マウントしてもバッジが消えない
  const { data } = useApi<{ unreadCount: number }>(
    signedIn ? "/api/me/notifications" : null,
    { refreshInterval: 60000, revalidateOnFocus: true },
  );

  const unread = Number(data?.unreadCount) || 0;

  return (
    <Link
      href="/notifications"
      className="relative p-2 -mr-1 text-slate-500 hover:text-slate-900 transition-colors"
      aria-label={unread > 0 ? `お知らせ（未読${unread}件）` : "お知らせ"}
    >
      <FontAwesomeIcon icon={faBell} className="w-4 h-4" />
      {unread > 0 && (
        <span className="absolute top-0.5 right-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
