"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { faLine } from "@fortawesome/free-brands-svg-icons";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Skeleton } from "@/lib/components/Skeleton";

// ============================================================
// お知らせ（アプリ内インボックス）。roadmap-2026-07 E⑤。
// notification-flow §1-2「インボックスが真実、LINE/push は配信」の受け皿。
// LINE 未連携でもここには必ず届く（＝取りこぼし無し）ので、
// 未連携の人にはマイページの LINE 連携への導線を上部に出す。
// ============================================================

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

/** 相対表記（今日/昨日）にして、古いものは日付。通知は「いつ来たか」が主関心のため。 */
function formatReceivedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(d, today)) return `今日 ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, yesterday)) return `昨日 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export default function NotificationsPage() {
  const { data, isInitialLoading, refresh } = useApi<{
    notifications: Notification[];
    unreadCount: number;
  }>("/api/me/notifications");
  const lineApi = useApi<{ configured: boolean; linked: boolean }>("/api/me/line");
  const [marking, setMarking] = useState(false);

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const showLinePrompt = Boolean(lineApi.data?.configured && !lineApi.data?.linked);

  const markAllRead = async () => {
    setMarking(true);
    try {
      await apiFetch("/api/me/notifications", {
        method: "PATCH",
        body: JSON.stringify({ all: true }),
      });
      await refresh();
    } catch {
      // 既読化の失敗は致命的でないため黙って諦める（次回開いたときに再挑戦できる）
    } finally {
      setMarking(false);
    }
  };

  const markOneRead = async (id: string) => {
    if (notifications.find((n) => n.id === id)?.read_at) return;
    try {
      await apiFetch("/api/me/notifications", {
        method: "PATCH",
        body: JSON.stringify({ ids: [id] }),
      });
      await refresh();
    } catch {
      // 同上
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-900">お知らせ</h1>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={marking}
            className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            {marking ? "処理中..." : "すべて既読にする"}
          </button>
        )}
      </div>

      {showLinePrompt && (
        <Link
          href="/me#line"
          className="flex items-center gap-3 mb-4 p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
        >
          <FontAwesomeIcon icon={faLine} className="w-5 h-5 text-[#06C755]" />
          <span className="flex-1 text-sm text-slate-700">
            LINEでも受け取れます
            <span className="block text-xs text-slate-500 mt-0.5">
              連携するとお知らせがLINEにも届きます
            </span>
          </span>
          <span className="text-slate-400" aria-hidden>
            ›
          </span>
        </Link>
      )}

      {isInitialLoading ? (
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <FontAwesomeIcon icon={faBell} className="w-8 h-8 text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">お知らせはまだありません</p>
        </div>
      ) : (
        <ul className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
          {notifications.map((n) => {
            const unread = !n.read_at;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => markOneRead(n.id)}
                  className="w-full text-left p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    {/* 未読ドット。既読でも位置がずれないよう領域は常に確保する */}
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${unread ? "bg-rose-500" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`text-sm truncate ${unread ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}
                        >
                          {n.title}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0 tabular-nums">
                          {formatReceivedAt(n.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words">
                        {n.body}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
