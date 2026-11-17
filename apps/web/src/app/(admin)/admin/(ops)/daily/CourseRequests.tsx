"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { apiFetch } from "@/lib/api";
import { hasCapability } from "@/lib/capabilities";
import { ReportContentView } from "@/lib/components/ReportContentView";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { formatDateSlashWeekdayJP } from "@repo/core/logic/calendar";
import type { ReportContentUnit } from "@/lib/reportContent";

type Report = { id: string; courseName: string; cycleNo: number; content: ReportContentUnit[]; approved?: boolean; meterValue?: number | null };
export type CourseRequestDay = { driverId: string; driverName: string; date: string; revision: string; reports: Report[]; requests: Report[] };

/** 本番の日報一覧に追加。数量の表示は通常日報と同じ共通部品を使う。 */
export function CourseRequests({ onDecision }: { onDecision: () => void }) {
  const { data, error, mutate } = useApi<{ days: CourseRequestDay[] }>("/api/admin/daily/course-requests");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ day: CourseRequestDay; approve: boolean } | null>(null);
  const canWrite = hasCapability("can_edit_reports");
  const decide = async () => {
    if (!decision || busy) return;
    setBusy(true); setFailure(null);
    try {
      await apiFetch(`/api/admin/daily/${decision.approve ? "approve" : "reject"}`, { method: "POST", body: JSON.stringify({
        driverId: decision.day.driverId, date: decision.day.date, expectedRevision: decision.day.revision, requestIds: decision.day.requests.map(q => q.id),
      }) });
      setDecision(null); await mutate(); onDecision();
    } catch (e) { setFailure(e instanceof Error ? e.message : "保存できませんでした。もう一度お試しください"); setDecision(null); }
    finally { setBusy(false); }
  };
  if (error) return <div role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">追加申請を読み込めませんでした。<button className="ml-2 min-h-11 underline" onClick={() => void mutate()}>再読み込み</button></div>;
  if (!data?.days?.length && !failure) return null;
  return <section className="space-y-3" aria-label="コース・便の追加申請">
    <h2 className="text-sm font-semibold text-slate-700">コース・便の追加申請</h2>
    {failure && <p role="alert" className="text-sm text-red-700">{failure} <button className="min-h-11 underline" onClick={() => { setFailure(null); void mutate(); }}>再読み込み</button></p>}
    {data?.days?.map(day => <article key={`${day.driverId}:${day.date}`} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{day.driverName}</h3><span className="text-xs text-slate-500">{formatDateSlashWeekdayJP(day.date)}</span></div>
      {[...day.reports, ...day.requests].map(r => <div key={r.id} className="border-t border-slate-100 pt-2">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{r.courseName}{r.cycleNo > 0 ? ` C${r.cycleNo}` : ""}</span>
          <span className={`rounded px-2 py-0.5 text-xs ${day.requests.some(q => q.id === r.id) ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{day.requests.some(q => q.id === r.id) ? "追加申請" : r.approved ? "承認済み" : "提出済み"}</span></div>
        <ReportContentView units={r.content} />
        {r.meterValue != null && <p className="text-xs text-slate-500">走行距離 {r.meterValue.toLocaleString()} km</p>}
      </div>)}
      {canWrite && <div className="flex justify-end gap-2 border-t border-slate-100 pt-3"><button disabled={busy} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm disabled:opacity-50" onClick={() => setDecision({ day, approve: false })}>却下</button><button disabled={busy} className="min-h-11 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={() => setDecision({ day, approve: true })}>日報と追加を承認</button></div>}
    </article>)}
    <ConfirmDialog open={!!decision} title={decision?.approve ? "日報と追加を承認しますか？" : "日報と追加を却下しますか？"} message={decision?.approve ? "この日の本人のシフトへ追加します。" : "この日の日報と追加申請を却下します。"} confirmLabel={busy ? "保存中…" : decision?.approve ? "承認する" : "却下する"} tone="neutral" onConfirm={() => void decide()} onClose={() => { if (!busy) setDecision(null); }} />
  </section>;
}
