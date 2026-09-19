"use client";

import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faRotateRight } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { cn } from "@/lib/ui/utils";

// ============================================================
// 外向きの経路で届かなかった通知。
// 設計: docs/design/operational-risk-detection-2026-09.md O-2
//
// ★通知を作ったこと＝伝わったこと ではない。アプリのお知らせには必ず入るが、
//   LINE 未連携・通知の許可なし・送信失敗では本人の手元では鳴らない。
//   再送して届くのは「送信に失敗」だけ。経路が無いものは電話など別の手段が要る。
// ============================================================

export const UNDELIVERED_KEY = "/api/admin/notifications/undelivered";

type Reason = "failed" | "unlinked" | "no_subscription" | "not_configured" | "no_attempt";

type Item = {
  id: string;
  driverName: string;
  kind: string;
  title: string;
  createdAt: string;
  read: boolean;
  reason: Reason;
  resendable: boolean;
};

const REASON_LABEL: Record<Reason, string> = {
  failed: "送信に失敗",
  unlinked: "LINE未連携",
  no_subscription: "通知の許可なし",
  not_configured: "会社で未設定",
  no_attempt: "送信していない",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
/** API の1回あたりの上限。超える分は分けて送る */
const RESEND_BATCH = 50;

function whenLabel(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getMonth() + 1}月${value.getDate()}日（${WEEKDAYS[value.getDay()]}）${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export default function UndeliveredTab({ canWrite }: { canWrite: boolean }) {
  const { data, refresh } = useApi<{ items: Item[]; unavailable?: boolean; truncated?: boolean; examined?: number }>(UNDELIVERED_KEY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 外へ送り直す操作なので、まとめて送る前に確認する
  const [asking, setAsking] = useState<string[] | null>(null);

  const items = useMemo(() => data?.items ?? [], [data]);
  const resendable = useMemo(() => items.filter((item) => item.resendable), [items]);

  if (data?.unavailable) {
    return <p className="py-8 text-center text-sm text-slate-500">配信の記録を取得できませんでした</p>;
  }
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        <FontAwesomeIcon icon={faCircleCheck} className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
        {data?.truncated ? "直近の通知はすべて届いています" : "直近2週間は全員に届いています"}
      </p>
    );
  }

  const resend = async (ids: string[]) => {
    if (ids.length === 0) return;
    setSending(true);
    try {
      let skipped = 0;
      for (let i = 0; i < ids.length; i += RESEND_BATCH) {
        const response = await apiFetch<{ skipped?: number }>(UNDELIVERED_KEY, {
          method: "POST",
          body: JSON.stringify({ ids: ids.slice(i, i + RESEND_BATCH) }),
        });
        skipped += Number(response?.skipped) || 0;
      }
      // 全部が対象外だった＝押しても何も起きない、を黙って終わらせない
      if (skipped === ids.length) {
        setError("この一覧は古くなっています。最新の状態では再送が要りません。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "再送できませんでした");
    } finally {
      // 途中で失敗しても、送れたぶんは一覧から消す（押し直して二重送信にしない）
      await refresh();
      setSending(false);
    }
  };

  return (
    <div className="mt-4">
      {canWrite && resendable.length > 0 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            disabled={sending}
            onClick={() => setAsking(resendable.map((item) => item.id))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40"
          >
            <FontAwesomeIcon icon={faRotateRight} className="h-3 w-3" />
            {sending ? "再送中…" : `失敗した${resendable.length}件を再送`}
          </button>
        </div>
      )}

      {data?.truncated && (
        <p className="mb-2 text-[11px] text-slate-500">直近{data.examined ?? 0}件の通知を調べました。それより前は確認していません</p>
      )}

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-bold",
                item.reason === "failed" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-700",
              )}
            >
              {REASON_LABEL[item.reason]}
            </span>
            <span className="font-medium text-slate-800">{item.driverName}</span>
            <span className="min-w-0 flex-1 truncate text-slate-600">{item.title}</span>
            {item.read && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3" />
                アプリで既読
              </span>
            )}
            <span className="tabular-nums text-slate-500">{whenLabel(item.createdAt)}</span>
            {canWrite && item.resendable && (
              <button
                type="button"
                disabled={sending}
                onClick={() => void resend([item.id])}
                className="min-h-11 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 disabled:opacity-40"
              >
                再送
              </button>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!asking}
        title="通知の再送"
        message={asking ? `${asking.length}件をもう一度送ります。` : ""}
        confirmLabel="送る"
        tone="neutral"
        onConfirm={() => {
          const ids = asking;
          setAsking(null);
          if (ids) void resend(ids);
        }}
        onClose={() => setAsking(null)}
      />
      <ErrorDialog open={!!error} message={error ?? ""} onClose={() => setError(null)} />
    </div>
  );
}
