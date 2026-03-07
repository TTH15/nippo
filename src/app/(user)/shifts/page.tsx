"use client";

import { useEffect, useState, useMemo } from "react";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

type ShiftRequest = {
  id: string;
  driver_id: string;
  request_date: string;
  request_type: string;
};

type MeShift = {
  shift_date: string;
  course_name: string;
  course_color: string | null;
  slot: number;
};

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function currentMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

type SubTabId = "request" | "view";

const SUB_TABS: { id: SubTabId; label: string }[] = [
  { id: "view", label: "シフト確認" },
  { id: "request", label: "希望休提出" },
];

export default function ShiftsPage() {
  const [subTab, setSubTab] = useState<SubTabId>("view");

  const [viewDate, setViewDate] = useState(currentMonth);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedOffDates, setSelectedOffDates] = useState<Set<string>>(new Set());
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);

  const [shiftMonth, setShiftMonth] = useState(() => currentYearMonth());
  const [shifts, setShifts] = useState<MeShift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  const days = useMemo(() => getDaysInMonth(viewDate.year, viewDate.month), [viewDate]);
  const monthStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, "0")}`;

  const shiftViewDays = useMemo(
    () => getDaysInMonth(shiftMonth.year, shiftMonth.month - 1),
    [shiftMonth]
  );
  const shiftViewFirstDow = new Date(shiftMonth.year, shiftMonth.month - 1, 1).getDay();
  const shiftViewEmptyCells = Array(shiftViewFirstDow).fill(null);
  const shiftsByDate = useMemo(() => {
    const m = new Map<string, MeShift[]>();
    shifts.forEach((s) => {
      const list = m.get(s.shift_date) ?? [];
      list.push(s);
      m.set(s.shift_date, list);
    });
    return m;
  }, [shifts]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ requests: ShiftRequest[] }>(`/api/shifts/requests?month=${monthStr}`);
      setRequests(res.requests);
      setSelectedOffDates(new Set((res.requests ?? []).map((r) => r.request_date)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === "request") {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr, subTab]);

  useEffect(() => {
    if (subTab !== "view") return;
    const { year, month } = shiftMonth;
    setShiftsLoading(true);
    setShiftsError(null);
    const { start, end } = getMonthDateRange(year, month);
    apiFetch<{ shifts: MeShift[] }>(`/api/me/shifts?start=${start}&end=${end}`)
      .then((d) => setShifts(d.shifts ?? []))
      .catch((e: unknown) => {
        console.error(e);
        setShiftsError("シフトの取得に失敗しました");
      })
      .finally(() => setShiftsLoading(false));
  }, [shiftMonth, subTab]);

  const prevMonth = () => {
    setViewDate((v) => {
      if (v.month === 0) return { year: v.year - 1, month: 11 };
      return { ...v, month: v.month - 1 };
    });
  };

  const nextMonth = () => {
    setViewDate((v) => {
      if (v.month === 11) return { year: v.year + 1, month: 0 };
      return { ...v, month: v.month + 1 };
    });
  };

  const getDateStr = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const isOffDay = (date: Date) => {
    return selectedOffDates.has(getDateStr(date));
  };

  const toggleOffDay = (date: Date) => {
    const dateStr = getDateStr(date);
    setSelectedOffDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const hasChanges = useMemo(() => {
    const serverSet = new Set(requests.map((r) => r.request_date));
    if (selectedOffDates.size !== serverSet.size) return true;
    for (const d of selectedOffDates) {
      if (!serverSet.has(d)) return true;
    }
    return false;
  }, [requests, selectedOffDates]);

  const submitOffDates = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const offDates = Array.from(selectedOffDates)
        .filter((d) => d.startsWith(monthStr))
        .sort();
      await apiFetch("/api/shifts/requests", {
        method: "POST",
        body: JSON.stringify({ month: monthStr, offDates }),
      });
      await load();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "シフト希望の保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、希望休を保存できませんでした。\n\n" +
          "通信状況を確認してから、もう一度「希望休を提出する」を押してください。\n" +
          "同じエラーが続く場合は、管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  const firstDayOfWeek = new Date(viewDate.year, viewDate.month, 1).getDay();
  const emptyCells = Array(firstDayOfWeek).fill(null);

  return (
    <>
      <div className="max-w-md mx-auto px-4 py-6">
        <h1 className="text-lg font-bold text-slate-900 mb-4">シフト</h1>

        {/* サブタブ: 希望休提出 / シフト確認 */}
        <div className="flex border-b border-slate-200 mb-6">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === tab.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 希望休提出 */}
        {subTab === "request" && (
          <>
            <p className="text-sm text-slate-500 mb-5">
              休みを希望する日をタップして選択し、「希望休を提出する」でまとめて送信します
            </p>

            <div className="flex items-center justify-between mb-4">
              <button
                onClick={prevMonth}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                ← 前月
              </button>
              <h2 className="text-base font-semibold text-slate-900">
                {viewDate.year}年 {monthNames[viewDate.month]}
              </h2>
              <button
                onClick={nextMonth}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                翌月 →
              </button>
            </div>

            {loading ? (
              <div className="bg-white rounded border border-slate-200 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {[...Array(7)].map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full max-w-[2rem] mx-auto" />
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {[...Array(35)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square w-full rounded" />
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded border border-slate-200 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {dayNames.map((name, i) => (
                    <div
                      key={name}
                      className={`text-center text-xs font-medium py-1.5 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}
                    >
                      {name}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {emptyCells.map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                  ))}
                  {days.map((date) => {
                    const isPast = date < today;
                    const isOff = isOffDay(date);
                    const dayOfWeek = date.getDay();
                    const isToday = date.toDateString() === today.toDateString();
                    return (
                      <button
                        key={getDateStr(date)}
                        onClick={(e) => {
                          if (!isPast) {
                            toggleOffDay(date);
                            (e.currentTarget as HTMLElement).blur();
                          }
                        }}
                        disabled={isPast}
                        className={`
                          aspect-square rounded flex flex-col items-center justify-center text-sm font-medium
                          transition-colors relative outline-none focus:outline-none
                          ${isPast ? "opacity-30 cursor-not-allowed" : "cursor-pointer hover:bg-slate-100"}
                          ${isOff ? "bg-red-100 border border-red-300" : "bg-slate-50"}
                          ${isToday ? "ring-2 ring-slate-400" : ""}
                        `}
                      >
                        <span className={dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : "text-slate-700"}>
                          {date.getDate()}
                        </span>
                        {isOff && (
                          <span className="text-red-500 font-bold absolute">
                            <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 bg-red-100 border border-red-300 rounded flex items-center justify-center">
                  <span className="text-red-500 text-[10px] font-bold">×</span>
                </div>
                <span>希望休</span>
              </div>
            </div>

            {!loading && hasChanges && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={submitOffDates}
                  disabled={saving}
                  className="w-full py-3 bg-brand-600 text-white font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "送信中..." : "希望休を提出する"}
                </button>
              </div>
            )}

            {selectedOffDates.size > 0 && (
              <div className="mt-4 bg-slate-50 rounded border border-slate-200 p-3">
                <h3 className="text-sm font-medium text-slate-700 mb-2">
                  {monthNames[viewDate.month]}の希望休: {selectedOffDates.size}日
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(selectedOffDates)
                    .filter((d) => d.startsWith(monthStr))
                    .sort()
                    .map((dateStr) => {
                      const [y, m, d] = dateStr.split("-").map(Number);
                      const localDate = new Date(y, m - 1, d);
                      return (
                        <span
                          key={dateStr}
                          className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 text-xs rounded"
                        >
                          {localDate.getMonth() + 1}/{localDate.getDate()}({dayNames[localDate.getDay()]})
                        </span>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}

        {/* シフト確認（カレンダー） */}
        {subTab === "view" && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() =>
                  setShiftMonth((m) => {
                    if (m.month === 1) return { year: m.year - 1, month: 12 };
                    return { ...m, month: m.month - 1 };
                  })
                }
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                ← 前月
              </button>
              <div className="text-sm font-medium text-slate-900">
                {shiftMonth.year}年 {shiftMonth.month}月
              </div>
              <button
                type="button"
                onClick={() =>
                  setShiftMonth((m) => {
                    if (m.month === 12) return { year: m.year + 1, month: 1 };
                    return { ...m, month: m.month + 1 };
                  })
                }
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors"
              >
                翌月 →
              </button>
            </div>
            {shiftsLoading ? (
              <div className="bg-white rounded border border-slate-200 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {dayNames.map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full max-w-[2rem] mx-auto" />
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {[...Array(35)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square w-full rounded min-h-[3.5rem]" />
                  ))}
                </div>
              </div>
            ) : shiftsError ? (
              <p className="text-sm text-red-600">{shiftsError}</p>
            ) : (
              <div className="bg-white rounded border border-slate-200 p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {dayNames.map((name, i) => (
                    <div
                      key={name}
                      className={`text-center text-xs font-medium py-1.5 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-slate-500"}`}
                    >
                      {name}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {shiftViewEmptyCells.map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square min-h-[3.5rem]" />
                  ))}
                  {shiftViewDays.map((date) => {
                    const dateStr = getDateStr(date);
                    const dayShifts = shiftsByDate.get(dateStr) ?? [];
                    const dayOfWeek = date.getDay();
                    const isToday = date.toDateString() === today.toDateString();
                    return (
                      <div
                        key={dateStr}
                        className={`aspect-square min-h-[3.5rem] rounded flex flex-col p-0.5 border border-transparent ${isToday ? "ring-2 ring-slate-400 ring-inset" : ""}`}
                      >
                        <span
                          className={`text-xs font-medium shrink-0 ${dayOfWeek === 0 ? "text-red-500" : dayOfWeek === 6 ? "text-blue-500" : "text-slate-700"}`}
                        >
                          {date.getDate()}
                        </span>
                        <div className="flex flex-wrap gap-0.5 overflow-hidden">
                          {dayShifts.map((s, idx) => (
                            <span
                              key={`${s.shift_date}-${s.course_name}-${idx}`}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-full"
                              style={
                                s.course_color
                                  ? { backgroundColor: s.course_color, color: "#ffffff" }
                                  : { backgroundColor: "#e2e8f0", color: "#475569" }
                              }
                              title={s.course_name || ""}
                            >
                              {s.course_name || "-"}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
    </>
  );
}
