"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preload } from "swr";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBriefcase, faPlus, faTrash, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { swrFetcher } from "@/lib/swr";
import { hasCapability } from "@/lib/capabilities";
import { Button } from "@/lib/ui/button";
import { todayJST, currentMonthJST, reportDateStrToDate } from "@/lib/date";
import { formatMonthDayJP } from "@repo/core/logic/calendar";
import { SpotJobModal } from "./SpotJobModal";
import { STATUS_LABEL, type MemberCandidate, type SpotJob, type SpotJobSavePayload } from "./types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

const STATUS_BADGE: Record<SpotJob["status"], string> = {
  planned: "bg-sky-50 text-sky-700",
  done: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-400",
};

export default function SpotJobsPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [month, setMonth] = useState(currentMonthJST());
  const [modal, setModal] = useState<{ mode: "create" | "edit"; job?: SpotJob } | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [errorState, setErrorState] = useState<{ message: string } | null>(null);

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_shifts"));
  }, []);

  const { data, error, isInitialLoading, mutate } = useApi<{ jobs: SpotJob[]; drivers: MemberCandidate[] }>(
    `/api/admin/spot-jobs?month=${month}`,
  );

  useEffect(() => {
    if (error) {
      setErrorState({ message: error instanceof Error ? error.message : "読み込みに失敗しました" });
    }
  }, [error]);

  // 前後月の preload（P9）: ◀▶ で移動したときスケルトンを出さない。重複は Set で防止。
  const prefetchedMonthsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!data) return;
    for (const delta of [-1, 1]) {
      const key = `/api/admin/spot-jobs?month=${shiftMonth(month, delta)}`;
      if (prefetchedMonthsRef.current.has(key)) continue;
      prefetchedMonthsRef.current.add(key);
      void preload(key, swrFetcher);
    }
    // month の変化は data 経由で反映される
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const jobs = data?.jobs ?? [];
  const drivers = data?.drivers ?? [];
  const driverNames = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);

  const load = useCallback(() => mutate(), [mutate]);
  const fail = (e: unknown) => setErrorState({ message: e instanceof Error ? e.message : "操作に失敗しました" });

  async function save(payload: SpotJobSavePayload) {
    if (!modal) return;
    if (modal.mode === "create") {
      // 作成はレスポンスの新規行をキャッシュへ追加（月全体の再取得を待たない）
      const res = await apiFetch<{ job: SpotJob }>("/api/admin/spot-jobs", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res?.job && res.job.jobDate?.startsWith(month)) {
        void mutate(
          (prev) => (prev ? { ...prev, jobs: [...prev.jobs, res.job] } : prev),
          { revalidate: false },
        );
      } else {
        // 表示中と別の月に作成した場合などはその月のキャッシュに任せる
        void load();
      }
    } else {
      // 更新はレスポンスの更新後行をキャッシュへ反映（レスポンス破棄→月全体再取得を廃止）
      const res = await apiFetch<{ job: SpotJob }>(`/api/admin/spot-jobs/${modal.job!.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (res?.job) {
        void mutate(
          (prev) =>
            prev ? { ...prev, jobs: prev.jobs.map((j) => (j.id === res.job.id ? res.job : j)) } : prev,
          { revalidate: false },
        );
      } else {
        void load();
      }
    }
    setModal(null);
  }

  const createGuest = useCallback(async (name: string): Promise<MemberCandidate> => {
    const res = await apiFetch<{ driver: MemberCandidate }>("/api/admin/spot-jobs/guests", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    void mutate(); // ピッカー候補に反映
    return res.driver;
  }, [mutate]);

  function askDelete(job: SpotJob) {
    setConfirmState({
      message: `${formatMonthDayJP(job.jobDate)}「${job.title}」を削除しますか？`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await apiFetch(`/api/admin/spot-jobs/${job.id}`, { method: "DELETE" });
          void load();
        } catch (e) {
          fail(e);
        }
      },
    });
  }

  function memberLabel(job: SpotJob): string {
    if (job.members.length === 0) return "—";
    return job.members
      .map((m) => (m.driverId ? (driverNames.get(m.driverId) ?? "（不明）") : (m.displayName ?? "")))
      .filter(Boolean)
      .join("、");
  }

  function timeLabel(job: SpotJob): string {
    if (!job.meetingTime && !job.endTime) return "—";
    return `${job.meetingTime ?? ""}〜${job.endTime ?? ""}`;
  }

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faBriefcase} className="w-5 h-5 text-slate-400" />
            単発案件
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setMonth((m) => shiftMonth(m, -1))} title="前の月">
              <FontAwesomeIcon icon={faChevronLeft} className="w-3 h-3" />
            </Button>
            <span className="text-sm font-medium text-slate-700 w-24 text-center">{monthLabel(month)}</span>
            <Button variant="outline" size="icon" onClick={() => setMonth((m) => shiftMonth(m, 1))} title="次の月">
              <FontAwesomeIcon icon={faChevronRight} className="w-3 h-3" />
            </Button>
            {canWrite && (
              <Button variant="default" size="default" onClick={() => setModal({ mode: "create" })}>
                <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                案件を追加
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
          コースを作らない一日きりの仕事と、その日の参加者（登録メンバー・その日だけの人）を記録します。
          金額はどちらも<b>参考値</b>で、請求・給与の確定計算には使われません。
        </p>

        {isInitialLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : jobs.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            {monthLabel(month)}の単発案件はありません
            {canWrite && <span>。「案件を追加」から登録できます</span>}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-xs">
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">日付</th>
                  <th className="text-left font-medium px-3 py-2.5">案件名</th>
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">時間</th>
                  <th className="text-left font-medium px-3 py-2.5">集合場所</th>
                  <th className="text-left font-medium px-3 py-2.5">参加者</th>
                  <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">請求（参考）</th>
                  <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">状態</th>
                  {canWrite && <th className="px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={canWrite ? () => setModal({ mode: "edit", job }) : undefined}
                    className={`border-b border-slate-50 last:border-b-0 ${canWrite ? "cursor-pointer hover:bg-slate-50" : ""} ${job.status === "cancelled" ? "opacity-60" : ""}`}
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                      {formatMonthDayJP(job.jobDate)}
                      <span className="text-[10px] text-slate-400 ml-1">
                        ({WEEKDAYS[reportDateStrToDate(job.jobDate).getDay()]})
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {job.title}
                      {job.clientName && <span className="text-[10px] text-slate-400 ml-1.5">{job.clientName}</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{timeLabel(job)}</td>
                    <td className="px-3 py-2.5 text-slate-600">{job.meetingPlace ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{memberLabel(job)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-600">
                      {job.billingAmount != null ? `¥${job.billingAmount.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE[job.status]}`}>
                        {STATUS_LABEL[job.status]}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2.5 text-right">
                        <button
                          title="削除"
                          onClick={(e) => {
                            e.stopPropagation();
                            askDelete(job);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:text-red-600 hover:bg-red-50"
                        >
                          <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <SpotJobModal
          mode={modal.mode}
          initial={modal.job}
          defaultDate={month === currentMonthJST() ? todayJST() : `${month}-01`}
          drivers={drivers}
          onSave={save}
          onClose={() => setModal(null)}
          createGuest={createGuest}
        />
      )}

      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        onClose={() => setConfirmState(null)}
        confirmLabel="削除"
      />
      <ErrorDialog open={!!errorState} message={errorState?.message ?? ""} onClose={() => setErrorState(null)} />
    </AdminLayout>
  );
}
