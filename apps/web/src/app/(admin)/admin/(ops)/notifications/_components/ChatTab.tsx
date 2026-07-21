"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane, faChevronLeft, faComments } from "@fortawesome/free-solid-svg-icons";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";

// ============================================================
// LINE チャット（roadmap-2026-07 E④）。連携済みドライバーとの1対1。
// PC = 2ペイン（一覧＋会話）、スマホ = 一覧 → 会話の切替。
// 相手の org 検証・ブロック判定はサーバー側（chats/[driverId]）が行う。
// ============================================================

type Thread = {
  driverId: string;
  name: string;
  blocked: boolean;
  lastMessage: string | null;
  lastDirection: string | null;
  lastAt: string | null;
  unreadCount: number;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  created_at: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export function ChatTab({ canWrite }: { canWrite: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 一覧は定期更新（新着を拾う）。会話は開いている間だけ短めに。
  const threadsApi = useApi<{ threads: Thread[]; totalUnread: number }>(
    "/api/admin/notifications/chats",
    { refreshInterval: 30000 },
  );
  const chatApi = useApi<{ driver: { id: string; name: string; blocked: boolean }; messages: Message[] }>(
    selected ? `/api/admin/notifications/chats/${selected}` : null,
    { refreshInterval: 15000 },
  );

  const threads = threadsApi.data?.threads ?? [];
  const messages = chatApi.data?.messages ?? [];

  // 新しいメッセージが来たら最下部へ
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selected]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setSending(true);
    try {
      await apiFetch(`/api/admin/notifications/chats/${selected}`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setDraft("");
      await chatApi.refresh();
      await threadsApi.refresh();
    } catch (e) {
      setError({
        title: "送信に失敗しました",
        message: e instanceof Error ? e.message : "不明なエラーが発生しました",
      });
    } finally {
      setSending(false);
    }
  };

  if (threadsApi.isInitialLoading) {
    return <Skeleton className="mt-4 h-96 w-full rounded-lg" />;
  }

  if (threads.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-8 text-center">
        <FontAwesomeIcon icon={faComments} className="mb-3 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">
          LINE連携済みのドライバーがまだいません。連携すると、ここでやり取りできます。
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex h-[min(70vh,600px)]">
          {/* スレッド一覧: スマホは会話を開いたら隠す */}
          <div
            className={`w-full overflow-y-auto border-r border-slate-200 md:w-64 md:shrink-0 ${
              selected ? "hidden md:block" : "block"
            }`}
          >
            <ul className="divide-y divide-slate-100">
              {threads.map((t) => (
                <li key={t.driverId}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.driverId)}
                    className={`w-full px-3 py-3 text-left transition-colors hover:bg-slate-50 ${
                      selected === t.driverId ? "bg-slate-50" : ""
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{t.name}</span>
                      {t.lastAt && (
                        <span className="shrink-0 text-xs text-slate-400 tabular-nums">
                          {formatTime(t.lastAt)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="flex-1 truncate text-xs text-slate-500">
                        {t.lastMessage
                          ? `${t.lastDirection === "outbound" ? "自分: " : ""}${t.lastMessage}`
                          : "メッセージはまだありません"}
                      </span>
                      {t.unreadCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] leading-none text-white tabular-nums">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                    {t.blocked && (
                      <span className="mt-1 block text-xs text-amber-600">ブロック中</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* 会話ペイン */}
          <div className={`flex w-full flex-col ${selected ? "flex" : "hidden md:flex"}`}>
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-400">
                左の一覧から相手を選んでください
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="-ml-1 p-1 text-slate-500 hover:text-slate-800 md:hidden"
                    aria-label="一覧へ戻る"
                  >
                    <FontAwesomeIcon icon={faChevronLeft} className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-medium text-slate-800">
                    {chatApi.data?.driver.name ?? ""}
                  </span>
                  {chatApi.data?.driver.blocked && (
                    <span className="text-xs text-amber-600">（ブロック中・送信できません）</span>
                  )}
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
                  {chatApi.isInitialLoading ? (
                    <Skeleton className="h-16 w-2/3 rounded-lg" />
                  ) : messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-400">
                      まだやり取りがありません
                    </p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.direction === "outbound";
                      return (
                        <div
                          key={m.id}
                          className={`flex ${mine ? "justify-end" : "justify-start"}`}
                        >
                          <div className={`max-w-[80%] ${mine ? "items-end" : "items-start"}`}>
                            <div
                              className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                                mine
                                  ? "bg-slate-800 text-white"
                                  : "border border-slate-200 bg-white text-slate-800"
                              }`}
                            >
                              {m.text}
                            </div>
                            <div
                              className={`mt-0.5 text-[10px] text-slate-400 ${mine ? "text-right" : ""}`}
                            >
                              {formatTime(m.created_at)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                <div className="flex items-end gap-2 border-t border-slate-200 p-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={!canWrite || chatApi.data?.driver.blocked}
                    rows={2}
                    maxLength={2000}
                    placeholder={canWrite ? "メッセージを入力" : "送信する権限がありません"}
                    className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
                    onKeyDown={(e) => {
                      // Enter 送信は誤爆しやすいので Cmd/Ctrl+Enter のみ。IME 変換中は無視。
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={!canWrite || sending || !draft.trim() || chatApi.data?.driver.blocked}
                    className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition-colors hover:bg-slate-800 disabled:opacity-40"
                    aria-label="送信"
                  >
                    <FontAwesomeIcon icon={faPaperPlane} className="h-4 w-4" />
                  </button>
                </div>
                {/* 送信は LINE push なので通数を消費する。受信（相手の返信）は無料。 */}
                <p className="px-3 pb-2 text-[11px] text-slate-400">
                  送信するとLINEの通数を1通消費します（相手からの返信は無料です）。
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <ErrorDialog
        open={!!error}
        title={error?.title ?? ""}
        message={error?.message ?? ""}
        onClose={() => setError(null)}
      />
    </>
  );
}
