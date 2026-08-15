"use client";

import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faXmark, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ErrorDialog } from "@/lib/components/ErrorDialog";

// ============================================================
// 確定後に変わった予定を、運営が確認してから送るための入口。
//
// ★画面に常駐させない。まだ通知していない日付には差分が出ないので、
//   前日の通知前にシフトを組み替えている間はこのバーは現れない。
//   「もう伝えてある予定が変わった」ときだけ足元に出る。
//
// 送信内容はサーバ側で計算し直される（ここで見せているのは確認用のプレビュー）。
// ============================================================

export const PENDING_CHANGES_KEY = "/api/admin/shifts/pending-changes";

type PendingChange = {
  date: string;
  dateLabel: string;
  driverId: string;
  driverName: string;
  kind: "added" | "canceled" | "changed";
  fields: string[];
  title: string;
  body: string;
  lineLinked: boolean;
};

type Response = {
  enabled: boolean;
  canSend: boolean;
  changes: PendingChange[];
};

const KIND_BADGE: Record<PendingChange["kind"], { label: string; className: string }> = {
  changed: { label: "変更", className: "bg-amber-100 text-amber-800" },
  added: { label: "追加", className: "bg-slate-200 text-slate-700" },
  canceled: { label: "取消", className: "bg-rose-100 text-rose-700" },
};

function itemKey(change: Pick<PendingChange, "date" | "driverId">): string {
  return `${change.date} ${change.driverId}`;
}

export default function PendingChangesBar() {
  const { data, refresh } = useApi<Response>(PENDING_CHANGES_KEY, {
    // シフト保存のたびに親から mutate されるので、自前の定期取得は持たない
    revalidateOnFocus: true,
  });
  const [open, setOpen] = useState(false);
  // 「外したもの」を持つ（選んだものではなく）。こうすると一覧が入れ替わっても
  // 新しく現れた変更は既定で選択状態になり、外した意思だけが残る
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);

  const changes = useMemo(() => data?.changes ?? [], [data]);
  const selectedKeys = useMemo(
    () => changes.map(itemKey).filter((key) => !excluded.has(key)),
    [changes, excluded],
  );

  // 差分が無くなったらモーダルごと閉じる（元に戻したときなど）
  useEffect(() => {
    if (changes.length === 0) setOpen(false);
  }, [changes.length]);

  if (!data?.enabled || changes.length === 0) return null;

  const dates = [...new Set(changes.map((c) => c.date))];
  const summary =
    dates.length === 1
      ? `${changes[0].dateLabel}の予定 ${changes.length}件`
      : `${changes[0].dateLabel}ほか${dates.length - 1}日の予定 ${changes.length}件`;

  const toggle = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const send = async () => {
    const chosen = new Set(selectedKeys);
    const items = changes
      .filter((c) => chosen.has(itemKey(c)))
      .map((c) => ({ date: c.date, driverId: c.driverId }));
    if (items.length === 0) return;

    setSending(true);
    try {
      const result = await apiFetch<{ sent: number; stale?: boolean }>(PENDING_CHANGES_KEY, {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      if (result.stale) {
        setError({
          message: "この変更は既に解消されていたため、送信しませんでした。",
          detail: "シフトが元に戻されたか、別の担当者が先に通知した可能性があります。",
        });
      }
      setOpen(false);
      await refresh();
    } catch (e) {
      setError({ message: "送信に失敗しました", detail: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* 表のレイアウトを動かさないよう、浮かせて足元に出す */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 print:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-amber-300 bg-white py-2 pl-4 pr-2 shadow-lg shadow-slate-900/10 transition-colors hover:bg-amber-50"
        >
          <FontAwesomeIcon icon={faBell} className="h-3.5 w-3.5 text-amber-600" />
          <span className="text-sm text-slate-700">
            通知済みの<span className="font-medium text-slate-900">{summary}</span>が変わっています
          </span>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-white">
            内容を確認
          </span>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">ドライバーへ変更を知らせる</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  送るものだけを選べます。送信するまでドライバーには届きません。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {dates.map((date) => {
                const rows = changes.filter((c) => c.date === date);
                return (
                  <div key={date} className="mb-4 last:mb-0">
                    <p className="sticky top-0 bg-white py-1 text-xs font-semibold text-slate-500">
                      {rows[0].dateLabel}
                    </p>
                    <div className="space-y-2">
                      {rows.map((change) => {
                        const key = itemKey(change);
                        const badge = KIND_BADGE[change.kind];
                        return (
                          <label
                            key={key}
                            className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={!excluded.has(key)}
                              onChange={() => toggle(key)}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-800"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                                  {badge.label}
                                </span>
                                <span className="text-sm font-medium text-slate-900">
                                  {change.driverName}
                                </span>
                                {!change.lineLinked && (
                                  <span className="text-[10px] text-slate-400">
                                    LINE未連携（アプリ内のみ）
                                  </span>
                                )}
                              </div>
                              <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-600">
                                {change.body}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() =>
                  setExcluded(
                    selectedKeys.length === changes.length ? new Set(changes.map(itemKey)) : new Set(),
                  )
                }
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                {selectedKeys.length === changes.length ? "選択を解除" : "すべて選択"}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
                >
                  あとで
                </button>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || selectedKeys.length === 0 || !data.canSend}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "送信中..." : `${selectedKeys.length}件を送信`}
                </button>
              </div>
            </div>

            {!data.canSend && (
              <p className="flex items-center gap-1.5 border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                <FontAwesomeIcon icon={faCircleInfo} className="h-3 w-3" />
                送信には通知配信の権限が必要です。
              </p>
            )}
          </div>
        </div>
      )}

      <ErrorDialog
        open={error !== null}
        title="送信結果"
        message={error?.message ?? ""}
        detail={error?.detail}
        onClose={() => setError(null)}
      />
    </>
  );
}
