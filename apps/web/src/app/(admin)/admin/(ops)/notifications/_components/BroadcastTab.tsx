"use client";

import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { faLine } from "@fortawesome/free-brands-svg-icons";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { Button } from "@/lib/ui/button";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";

// ============================================================
// 通知の一斉配信（roadmap-2026-07 E④ / notification-flow §3 モード3）。
// 用途: 台風で本日休み・希望休の締切連絡・KYC承認の催促など。
//
// 誤爆防止（§1-3 レイヤ5「UIスコープ」）: 受信者の候補は API が返す
// 自社 active メンバーのみ。この画面から他社を選ぶ手段は存在しない。
// 送信は取り消せないため、必ず ConfirmDialog を挟む。
// ============================================================

const MAX_TITLE = 100;
const MAX_BODY = 1000;

type Member = {
  driverId: string;
  name: string;
  lineLinked: boolean;
  lineBlocked: boolean;
};

type Broadcast = { id: string; title: string; body: string; created_at: string };

type Res = {
  lineConfigured: boolean;
  members: Member[];
  linkedCount: number;
  recentBroadcasts: Broadcast[];
};

type SendResult = {
  created: number;
  skipped: number;
  lineSent: number;
  lineFailed: number;
  webPushSent: number;
  webPushFailed: number;
};

export function BroadcastTab() {
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => {
    setCanWrite(hasCapability("can_send_notifications"));
  }, []);

  const { data, isInitialLoading, refresh } = useApi<Res>("/api/admin/notifications");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<"all" | "select">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const members = useMemo(() => data?.members ?? [], [data]);
  const recipients = target === "all" ? members : members.filter((m) => selected.includes(m.driverId));
  const unlinkedCount = members.filter((m) => !m.lineLinked || m.lineBlocked).length;
  const canSend = canWrite && title.trim() !== "" && body.trim() !== "" && recipients.length > 0;

  const toggle = (driverId: string) =>
    setSelected((s) => (s.includes(driverId) ? s.filter((x) => x !== driverId) : [...s, driverId]));

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await apiFetch<SendResult>("/api/admin/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          // 全員送信のときは driverIds を送らない（サーバー側で org の active 全員に解決される）
          ...(target === "select" ? { driverIds: selected } : {}),
        }),
      });
      setResult(res);
      setTitle("");
      setBody("");
      setSelected([]);
      await refresh();
    } catch (e) {
      setError({
        title: "送信に失敗しました",
        message: e instanceof Error ? e.message : "不明なエラーが発生しました",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div>
        {isInitialLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : (
          <>
            {/* LINE 未設定でもインボックスには届くので、送信自体は止めない */}
            {data && !data.lineConfigured && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 shrink-0" />
                <span>
                  LINE連携が未設定のため、送信してもアプリの「お知らせ」にのみ届きます。
                </span>
              </div>
            )}

            {/* §1-2「未連携を可視化＝催促可能」 */}
            {data?.lineConfigured && unlinkedCount > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
                <FontAwesomeIcon icon={faLine} className="mt-0.5 shrink-0 text-[#06C755]" />
                <span>
                  LINE連携済み {data.linkedCount}名 / 全{members.length}名。
                  未連携の{unlinkedCount}名にはアプリの「お知らせ」のみ届きます。
                </span>
              </div>
            )}

            {result && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                {result.created}名に送信しました
                {(result.lineSent > 0 || result.webPushSent > 0) && (
                  <>
                    （
                    {[
                      result.lineSent > 0 ? `LINE ${result.lineSent}件` : null,
                      result.webPushSent > 0 ? `端末通知 ${result.webPushSent}件` : null,
                    ]
                      .filter(Boolean)
                      .join("・")}
                    ）
                  </>
                )}
                {result.lineFailed > 0 && (
                  <span className="text-amber-700">／LINE送信に失敗 {result.lineFailed}件</span>
                )}
              </div>
            )}

            <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <label className="mb-1 block text-xs font-medium text-slate-500">件名</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!canWrite}
                maxLength={MAX_TITLE}
                placeholder="例: 本日の稼働について"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
              />

              <label className="mb-1 mt-4 block text-xs font-medium text-slate-500">本文</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canWrite}
                rows={5}
                maxLength={MAX_BODY}
                placeholder="例: 降雪のため、本日の配送は全便中止とします。出社の必要はありません。"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
              />
              <div className="mt-1 text-right text-xs text-slate-400 tabular-nums">
                {body.length} / {MAX_BODY}
              </div>

              <div className="mt-4">
                <span className="mb-2 block text-xs font-medium text-slate-500">送信先</span>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="target"
                      checked={target === "all"}
                      onChange={() => setTarget("all")}
                      disabled={!canWrite}
                      className="h-4 w-4 accent-slate-800"
                    />
                    全員（{members.length}名）
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="target"
                      checked={target === "select"}
                      onChange={() => setTarget("select")}
                      disabled={!canWrite}
                      className="h-4 w-4 accent-slate-800"
                    />
                    選んで送る
                  </label>
                </div>
              </div>

              {target === "select" && (
                <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {members.map((m) => (
                    <label
                      key={m.driverId}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(m.driverId)}
                        onChange={() => toggle(m.driverId)}
                        disabled={!canWrite}
                        className="h-4 w-4 rounded border-slate-300 accent-slate-800"
                      />
                      <span className="flex-1 truncate">{m.name}</span>
                      {m.lineLinked && !m.lineBlocked ? (
                        <FontAwesomeIcon
                          icon={faLine}
                          className="shrink-0 text-[#06C755]"
                          title="LINE連携済み"
                        />
                      ) : (
                        <span className="shrink-0 text-xs text-slate-400">アプリのみ</span>
                      )}
                    </label>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-500 tabular-nums">
                  送信先 {recipients.length}名
                </span>
                <Button
                  size="touch"
                  disabled={!canSend || sending}
                  onClick={() => setConfirming(true)}
                >
                  {sending ? "送信中..." : "送信する"}
                </Button>
              </div>
              {!canWrite && (
                <p className="mt-2 text-sm text-slate-500">
                  このロールには通知を送信する権限がありません。
                </p>
              )}
            </section>

            {data && data.recentBroadcasts.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 text-sm font-bold text-slate-700">最近の送信</h2>
                <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                  {data.recentBroadcasts.map((b) => (
                    <li key={b.id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{b.title}</span>
                        <span className="shrink-0 text-xs text-slate-400 tabular-nums">
                          {new Date(b.created_at).toLocaleString("ja-JP", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-500">{b.body}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="通知を送信します"
        message={`${recipients.length}名に「${title.trim()}」を送信します。送信後は取り消せません。`}
        confirmLabel="送信する"
        onConfirm={send}
        onClose={() => setConfirming(false)}
      />
      <ErrorDialog
        open={!!error}
        title={error?.title ?? ""}
        message={error?.message ?? ""}
        onClose={() => setError(null)}
      />
    </>
  );
}
