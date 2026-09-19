"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCircleCheck, faRotate } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";

// ============================================================
// 本人が自分の予定を確認する。通知の既読とは別の事実として送る。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1「本人が予定を確認する」
//
// 確認は「そのときの版」に対して成立する。集合時刻などが変われば確認は外れ、
// ここに再確認として戻ってくる。
// ============================================================

type ConfirmationDay = {
  date: string;
  planVersion: string;
  response: "confirmed" | "unavailable" | null;
  staleResponse: "confirmed" | "unavailable" | null;
  respondedAt: string | null;
};

type Response = { days: ConfirmationDay[]; unavailable?: boolean };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 何日先までを確認の対象にするか（管理側の未解決一覧と同じ） */
const HORIZON_DAYS = 14;

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateLabel(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日（${WEEKDAYS[value.getUTCDay()]}）`;
}

function AnswerLabel({ response, muted }: { response: "confirmed" | "unavailable"; muted?: boolean }) {
  if (response === "confirmed") {
    return (
      <span className={muted ? "inline-flex items-center gap-1 text-slate-500" : "inline-flex items-center gap-1 font-medium text-emerald-700"}>
        <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3" />
        確認済み
      </span>
    );
  }
  return <span className={muted ? "text-slate-500" : "font-medium text-rose-700"}>対応できないと回答済み</span>;
}

export default function ShiftPlanConfirmations() {
  const start = jstToday();
  const end = addDays(start, HORIZON_DAYS);
  const { data, refresh } = useApi<Response>(`/api/me/shift-confirmations?start=${start}&end=${end}`);
  const [sending, setSending] = useState<string | null>(null);
  const [asking, setAsking] = useState<ConfirmationDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 回答済みの日を選び直しているところ。押し間違いから戻れるようにする
  const [editing, setEditing] = useState<string | null>(null);

  const days = data?.days ?? [];
  if (data?.unavailable || days.length === 0) return null;

  const send = async (day: ConfirmationDay, response: "confirmed" | "unavailable") => {
    setSending(day.date);
    try {
      await apiFetch("/api/me/shift-confirmations", {
        method: "POST",
        body: JSON.stringify({ date: day.date, planVersion: day.planVersion, response }),
      });
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認を送れませんでした");
      // 版が変わっていた場合は最新に入れ替える
      await refresh();
    } finally {
      setSending(null);
    }
  };

  const pending = days.filter((day) => day.response == null);

  return (
    <section className="mt-4 rounded border border-slate-200 bg-white p-3" aria-label="予定の確認">
      <h3 className="mb-2 text-sm font-medium text-slate-700">
        予定の確認{pending.length > 0 ? `（未確認 ${pending.length}日）` : ""}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {days.map((day) => {
          const busy = sending === day.date;
          const answered = day.response != null && editing !== day.date;
          const answer = day.response;
          return (
            <li key={day.date} className="flex flex-wrap items-center gap-2 py-1 text-xs">
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 tabular-nums text-slate-600">
                {dateLabel(day.date)}
              </span>
              {answered && answer ? (
                <>
                  <AnswerLabel response={answer} />
                  <button
                    type="button"
                    onClick={() => setEditing(day.date)}
                    className="ml-auto min-h-11 rounded-lg border border-slate-200 px-3 text-xs text-slate-600"
                  >
                    選び直す
                  </button>
                </>
              ) : (
                <>
                  {/* 選び直し中は、いまの回答を薄く残す（未回答の行と見分けられるように） */}
                  {answer != null && <AnswerLabel response={answer} muted />}
                  {day.staleResponse && (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <FontAwesomeIcon icon={faRotate} className="h-3 w-3" />
                      予定が変わりました
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void send(day, "confirmed")}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <FontAwesomeIcon icon={faCheck} className="h-3 w-3" />
                      確認
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAsking(day)}
                      className="min-h-11 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 disabled:opacity-50"
                    >
                      対応できない
                    </button>
                    {answer != null && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing(null)}
                        className="min-h-11 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 disabled:opacity-50"
                      >
                        やめる
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!asking}
        title={asking ? `${dateLabel(asking.date)}の予定` : ""}
        message="対応できないと運営へ伝えます。"
        confirmLabel="対応できないと伝える"
        onConfirm={() => {
          const day = asking;
          setAsking(null);
          if (day) void send(day, "unavailable");
        }}
        onClose={() => setAsking(null)}
      />
      <ErrorDialog open={!!error} message={error ?? ""} onClose={() => setError(null)} />
    </section>
  );
}
